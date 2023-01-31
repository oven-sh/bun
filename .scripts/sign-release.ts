/// <reference types="bun-types" />
import { SHA256, which, write, spawnSync } from "bun";
import { isatty } from "node:tty";
import { createInterface } from "node:readline";

const tag = process.argv[2];
const url = tag
  ? `https://api.github.com/repos/oven-sh/bun/releases/tags/${tag}`
  : "https://api.github.com/repos/oven-sh/bun/releases/latest";
const response = await fetch(url);
if (response.status === 404) {
  throw new Error(`Release not found: ${tag}`);
}
if (!response.ok) {
  throw new Error(`Failed to find release: ${tag} [status: ${response.status}]`);
}
const release: any = await response.json();
if (release.assets.find(({ name }) => name === "SHA256SUMS.txt.asc")) {
  throw new Error(`Release already signed: ${tag}`);
}
const sha256s = await Promise.all(
  release.assets.map(async ({ name, browser_download_url }) => {
    return `${await sha256(browser_download_url)}  ${name}`;
  }),
);
await write("SHASUMS256.txt", sha256s.join("\n"));
await sign("SHASUMS256.txt");

async function sha256(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to find asset: ${url} [status: ${response.status}]`);
  }
  const body = await response.arrayBuffer();
  const sha256 = SHA256.hash(body);
  return Buffer.from(sha256).toString("hex");
}

async function sign(path: string): Promise<void> {
  // https://www.gnupg.org/gph/en/manual/x135.html
  if (!which("gpg")) {
    throw new Error("Command not found: gpg");
  }
  const { stdout } = spawnSync(
    [
      "gpg",
      "--list-secret-keys",
      "--keyid-format",
      "long"
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  if (!stdout.includes("F3DCC08A8572C0749B3E18888EAB4D40A7B22B59")) {
    console.warn("Signature is likely wrong, key not found: robobun@oven.sh");
  }
  const passphrase = await prompt("Passphrase:");
  spawnSync(
    [
      "gpg",
      "--batch",
      "--yes",
      "--clearsign",
      "--output",
      `${path}.asc`,
      path
    ],
    {
      stdin: new TextEncoder().encode(passphrase),
      stdout: "inherit",
      stderr: "inherit",
    }
  );
}

async function prompt(question: string): Promise<string> {
  if (isatty(process.stdout.fd)) {
    return globalThis.prompt(question) || "";
  }
  const reader = createInterface({
    input: process.stdin,
    terminal: false
  });
  let buffer = "";
  reader.on("line", (line) => {
    buffer += line;
  });
  return new Promise((resolve) => {
    reader.once("close", () => resolve(buffer));
  });
}
