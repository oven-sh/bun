import { $ } from "bun";
import { dirname, join, relative } from "path";

// Check for local changes in git before proceeding
const statusOutput = await $`git status --porcelain --untracked-files=normal`.text();

if (statusOutput.trim().length > 0) {
  console.error("There are local changes in git. Please commit or stash them before running this command.");
  console.error("Git status:");
  console.error(statusOutput);
  process.exit(1);
}

async function revertUnstagedChanges() {
  // Discard ONLY worktree changes; keep index (staged) intact.
  // Prefer `git restore` (Git ≥2.23), fall back to `git checkout` for older Git.
  try {
    const restore = Bun.spawn({
      cmd: ["git", "restore", "--worktree", "--", "."],
      stdio: ["ignore", "ignore", "inherit"],
    });
    await restore.exited;
    if (restore.exitCode !== 0) {
      const checkout = Bun.spawn({
        cmd: ["git", "checkout", "--", "."],
        stdio: ["ignore", "ignore", "inherit"],
      });
      await checkout.exited;
    }
  } catch {
    // Best-effort; ignore restore errors so the main task can still complete.
  }
}

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
    .filter(arg => {
      if (arg === "-fsanitize-address") return false; // not available upstream
      return true;
    })
    .map(arg => {
      if (arg.includes("=")) {
        const [flag, value] = arg.split("=");
        return `${flag}=${backmap.get(value) ?? value}`;
      }
      return arg;
    })
    .join(" "),
);

// Prepare zig source for use with the upstream compiler
{
  const fmt = Bun.spawn({
    cmd: ["./vendor/zig/zig", "fmt", "--upstream", "src"],
    stdio: ["inherit", "inherit", "inherit"],
  });
  await fmt.exited;
  if (fmt.exitCode !== 0) {
    await revertUnstagedChanges();
    console.error("`zig fmt` failed.");
    process.exit(fmt.exitCode ?? 1);
  }
}

try {
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
} finally {
  // Always clean up any fmt-induced worktree changes (preserve index)
  await revertUnstagedChanges();
}
