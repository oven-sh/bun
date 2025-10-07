import { confirm, exit, log, stdin, warn } from "../src/console";
import { fetch } from "../src/fetch";
import { basename, blob, hash, join, rm, tmp, write } from "../src/fs";
import { getRelease, uploadAsset } from "../src/github";
import { spawn } from "../src/spawn";

const [tag, ...paths] = process.argv.slice(2);

if (!tag) {
  exit("Invalid arguments: [tag] [...assets]");
}

const { tag_name, assets } = await getRelease(tag);
log("Release:", tag_name, "\n");
log("Existing assets:\n", ...assets.map(({ name }) => `- ${name}\n`));
log("Updating assets:\n", ...paths.map(path => `+ ${basename(path)}\n`));
await confirm();

log("Hashing assets...\n");
const existing: Map<string, string> = new Map();
for (const { name, browser_download_url } of assets) {
  if (name.startsWith("SHASUMS256.txt")) {
    continue;
  }
  const response = await fetch(browser_download_url);
  const buffer = Buffer.from(await response.arrayBuffer());
  existing.set(name, await hash(buffer));
}
const updated: Map<string, string> = new Map();
for (const path of paths) {
  const name = basename(path);
  updated.set(name, await hash(path));
}
log(
  "Unchanged hashes:\n",
  ...Array.from(existing.entries())
    .filter(([name]) => !updated.has(name))
    .map(([name, sha256]) => ` - ${sha256} => ${name}\n`),
);
log("Changed hashes:\n", ...Array.from(updated.entries()).map(([name, sha256]) => ` + ${sha256} => ${name}\n`));
await confirm();

log("Signing assets...\n");
const cwd = tmp();
const path = join(cwd, "SHASUMS256.txt");
const signedPath = `${path}.asc`;
write(
  path,
  [...Array.from(updated.entries()), ...Array.from(existing.entries()).filter(([name]) => !updated.has(name))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, sha256]) => `${sha256}  ${name}`)
    .join("\n"),
);
const { stdout: keys } = spawn("gpg", ["--list-secret-keys", "--keyid-format", "long"]);
const verifiedKeys = [
  "F3DCC08A8572C0749B3E18888EAB4D40A7B22B59", // robobun@oven.sh
];
if (!verifiedKeys.find(key => keys.includes(key))) {
  warn("Signature is probably wrong, key not found: robobun@oven.sh");
}
const passphrase = await stdin("Passphrase:");
log();
const { exitCode, stdout, stderr } = spawn(
  "gpg",
  ["--pinentry-mode", "loopback", "--passphrase-fd", "0", "--clearsign", "--output", signedPath, path],
  {
    // @ts-ignore
    input: passphrase,
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (exitCode !== 0) {
  exit(stdout || stderr);
}

const uploads = [...paths, path, signedPath];
log("Uploading assets:\n", ...uploads.map(path => ` + ${basename(path)}\n`));
await confirm();

for (const path of uploads) {
  const name = basename(path);
  await uploadAsset(tag_name, name, blob(path));
}
try {
  rm(cwd);
} catch {
  warn("Failed to cleanup:", cwd, "\n");
}
log("Done");

process.exit(0); // FIXME
