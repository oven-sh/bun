#!/usr/bin/env node

// Signs the macOS binaries of a release with Bun's Developer ID certificate, and
// uploads the zips again under the same names.
//
//   sign-darwin-artifacts.ts <zip>=<key of the step that built it>...

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { output, run } from "../../scripts/agent.ts";
import { getEnv, getReleaseVersion, readSecret, startGroup } from "../../scripts/buildkite.ts";

const teamId = "7FRXF46ZSN";
const work = mkdtempSync(join(tmpdir(), "sign-"));
const keychain = join(work, "signing.keychain-db");

/** Its arguments hold passwords, so they stay out of the error. */
function security(command: string, ...args: string[]): void {
  const { status } = spawnSync("security", [command, ...args], { stdio: ["ignore", "ignore", "inherit"] });
  if (status !== 0) {
    throw new Error(`security ${command} failed`);
  }
}

async function importIdentity(): Promise<void> {
  const keychainPassword = randomUUID();
  security("create-keychain", "-p", keychainPassword, keychain);
  security("set-keychain-settings", keychain); // never lock
  security("unlock-keychain", "-p", keychainPassword, keychain);

  // codesign needs the certificate's issuer, which the .p12 does not carry.
  for (const authority of ["DeveloperIDCA.cer", "DeveloperIDG2CA.cer"]) {
    const url = `https://www.apple.com/certificateauthority/${authority}`;
    await run(["curl", "-fsSL", "--retry", "3", "-o", authority, url], { cwd: work });
    security("import", join(work, authority), "-k", keychain);
  }

  const identity = join(work, "identity.p12");
  writeFileSync(identity, readSecret("APPLE_DEVELOPER_ID_P12_BASE64"), { encoding: "base64", mode: 0o600 });
  const password = readSecret("APPLE_DEVELOPER_ID_P12_PASSWORD");
  security("import", identity, "-k", keychain, "-f", "pkcs12", "-P", password, "-T", "/usr/bin/codesign");
  rmSync(identity);

  // Without this, codesign waits on a keychain prompt.
  security("set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychain);
  security("list-keychains", "-d", "user", "-s", keychain);
}

async function verify(binary: string): Promise<void> {
  // What earlier releases are signed as, so macOS takes this binary for the same program.
  const requirement = [
    `identifier "${basename(binary)}"`,
    "anchor apple generic",
    "certificate 1[field.1.2.840.113635.100.6.2.6] exists",
    "certificate leaf[field.1.2.840.113635.100.6.1.13] exists",
    `certificate leaf[subject.OU] = "${teamId}"`,
  ].join(" and ");
  await run(["codesign", "--verify", "--strict", "--verbose=2", `--test-requirement==${requirement}`, binary]);

  const { stderr: details } = spawnSync("codesign", ["--display", "--verbose=3", binary], { encoding: "utf8" });
  console.log(details);
  for (const expected of ["flags=0x10000(runtime)", "Hash type=sha256", "Timestamp="]) {
    if (!details.includes(expected)) {
      throw new Error(`The signature of ${binary} does not have ${expected}`);
    }
  }
}

async function smokeTest(binary: string): Promise<void> {
  const expected = `${getReleaseVersion()}+${getEnv("BUILDKITE_COMMIT").slice(0, 9)}`;
  const actual = output([binary, "--revision"])?.trim();
  if (actual !== expected) {
    throw new Error(`${binary} --revision printed ${actual}, expected ${expected}`);
  }
  // `--compile` edits a copy of the binary, signature included.
  writeFileSync(join(work, "smoke.js"), 'console.log("ok")');
  await run([binary, "build", "--compile", "smoke.js", "--outfile", "smoke"], { cwd: work });
  await run([join(work, "smoke")]);
}

async function sign(zip: string, step: string): Promise<void> {
  const directory = basename(zip, ".zip");
  const isProfile = directory.endsWith("-profile");
  const binary = join(work, directory, isProfile ? "bun-profile" : "bun");
  const entitlements = isProfile
    ? join(import.meta.dirname, "entitlements.profile.plist")
    : join(import.meta.dirname, "..", "..", "entitlements.plist");

  await run(["buildkite-agent", "artifact", "download", zip, ".", "--step", step], { cwd: work });
  await run(["unzip", "-q", zip], { cwd: work });
  rmSync(join(work, zip));
  const flags = ["--options", "runtime", "--force", "--timestamp", "-vvvv", "--deep", "--strict"];
  const identity = ["--keychain", keychain, "--sign", "Developer ID Application"];
  await run(["codesign", "--entitlements", entitlements, ...flags, ...identity, binary]);
  await verify(binary);
  if (directory.includes("-aarch64")) {
    await smokeTest(binary);
  }
  await run(["ditto", "-ck", "--rsrc", "--sequesterRsrc", "--keepParent", directory, zip], { cwd: work });
  await run(["buildkite-agent", "artifact", "upload", zip], { cwd: work });
  rmSync(join(work, directory), { recursive: true });
  rmSync(join(work, zip));
}

try {
  await startGroup("Importing the certificate", importIdentity);
  for (const argument of process.argv.slice(2)) {
    const [zip, step] = argument.split("=") as [string, string];
    await startGroup(`Signing ${zip}`, () => sign(zip, step));
  }
} finally {
  spawnSync("security", ["delete-keychain", keychain], { stdio: "ignore" });
  rmSync(work, { recursive: true, force: true });
}
