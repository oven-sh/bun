import { $ } from "bun";
import { relative, join, dirname } from "path";

// // Check for local changes in git before proceeding
// const statusOutput = await $`git status --porcelain`.text();

// if (statusOutput.trim().length > 0) {
//   console.error("There are local changes in git. Please commit or stash them before running this command.");
//   console.error("Git status:");
//   console.error(statusOutput);
//   process.exit(1);
// }

// TODO: automatically run `./vendor/zig/zig fmt src --upstream` and then revert local changes at the end
// only do this with the above git state assertion

let skip = -1;
const args = process.argv.slice(2).filter((arg, i) => {
  if (arg === "--listen=-") return false;
  if (arg === "--zig-lib-dir") {
    skip = i + 1;
    return false;
  }
  if (skip === i) return false;
  return true;
});
if (args.length === 0) {
  console.error(`Usage: bun scripts/pack-codegen-for-zig-team <full crashing zig command>

The full command should be displayed in the build failure message. It should start with /path/to/zig build-obj ..... and end with --listen=-`);
  process.exit(1);
}
if (!args[0].includes("zig")) {
  console.error("First argument must be a zig command: ", args[0]);
  process.exit(1);
}
if (args[1] === "build") {
  console.error("build not supported. Expected a `zig build-obj` command.");
  process.exit(1);
}
args.shift();

let resolvedZigFiles = new Set<string>();
const backmap = new Map<string, string>();
for (const arg of args) {
  const [_, file] = arg.split("=");
  if (!file) continue;
  if (!file.includes("/")) continue;
  const resolved = relative(".", file);
  if (resolved.startsWith("..")) {
    console.error("File is outside of the current directory: ", file);
    process.exit(1);
  }
  resolvedZigFiles.add(resolved);
  backmap.set(file, resolved);
}

for (const file of resolvedZigFiles) {
  let content: string;
  try {
    content = await Bun.file(file).text();
  } catch (e) {
    console.error("Failed to read file: ", file);
    resolvedZigFiles.delete(file);
    continue;
  }

  if (!file.endsWith(".zig")) continue;
  const imports = content.matchAll(/@(?:import|embedFile)\("([^"]+)"\)/g);
  for (const [_, imported] of imports) {
    if (!imported.includes("/") && !imported.includes(".")) continue;
    const resolved = join(dirname(file), imported);
    resolvedZigFiles.add(resolved);
  }
}

// now, create zip

const out_args = "build/all.args";
const out = "codegen-for-zig-team.tar.gz";
try {
  await Bun.file(out).delete();
} catch (e) {}

const a0 = args.shift();
await Bun.write(
  out_args,
  args
    .map(arg => {
      if (arg.includes("=")) {
        const [flag, value] = arg.split("=");
        return `${flag}=${backmap.get(value) ?? value}`;
      }
      return arg;
    })
    .join(" "),
);

const spawned = Bun.spawn({
  cmd: ["tar", "--no-xattrs", "-zcf", out, out_args, ...resolvedZigFiles],
  stdio: ["inherit", "inherit", "inherit"],
});
await spawned.exited;
if (spawned.exitCode !== 0) {
  console.error("Failed to create zip: ", spawned.exitCode);
  process.exit(1);
}
console.log(`
pack-codegen-for-zig-team
Reminder: Use \`./vendor/zig/zig fmt --upstream src\` before running pack-codegen-for-zig-team.ts
Reminder: Test that the reproduction steps work with the official Zig binary before submitting the issue.

Output file: ${out}

Reproduction steps:

Download codegen-for-zig-team.tar.gz
\`\`\`sh
cd /empty/folder
wget ....
tar -xvzf codegen-for-zig-team.tar.gz
zig ${a0} @${out_args}
\`\`\`
`);
console.log("->", out);
