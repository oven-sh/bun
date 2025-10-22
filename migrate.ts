import { $ } from "bun";
import { readdir } from "fs/promises";

// next to migrate is std.io.BufferedWriter → (copy old implementation for now)

function replacements(content: string): string {
  return content
    .replaceAll("std.fifo.LinearFifo", "bun.LinearFifo")
    .replaceAll("bun.LinearFifoBufferType.Dynamic", ".Dynamic")
    .replaceAll(/\bstd\.ArrayList\b/g, "std.array_list.Managed")
    .replaceAll(/\bstd\.ArrayListAligned\b/g, "std.array_list.AlignedManaged")
    .replaceAll("std.io.Writer(", "std.Io.GenericWriter(")
    .replaceAll("std.io.Reader(", "std.Io.GenericReader(")
    .replaceAll("std.io.BufferedWriter(", "bun.deprecated.BufferedWriter(")
    .replaceAll("std.io.bufferedWriter(", "bun.deprecated.bufferedWriter(")
    .replaceAll("std.io.BufferedReader(", "bun.deprecated.BufferedReader(")
    .replaceAll("std.io.bufferedReader(", "bun.deprecated.bufferedReader(")
    .replaceAll("callconv(.C)", "callconv(.c)")
    .replaceAll("std.posix.empty_sigset", "std.posix.sigemptyset()")
    .replaceAll("std.io.getStdOut()", "std.fs.File.stdout()")
    .replaceAll("std.io.getStdErr()", "std.fs.File.stderr()")
    .replaceAll("std.io.getStdIn()", "std.fs.File.stdin()") // .replaceAll("std.fmt.Formatter", "std.fmt.Alt") // hand-convert for searchability
    .replaceAll("std.zig.fmtEscapes", "std.zig.fmtString")
    .replaceAll("std.SinglyLinkedList", "bun.deprecated.SinglyLinkedList")
    .replaceAll("fmt.formatIntBuf", "fmt.printInt")
    .replaceAll("ascii.isASCII", "ascii.isAscii")
    .replaceAll("std.time.sleep", "std.Thread.sleep")
    .replaceAll("comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype", "writer: *std.Io.Writer")
    .replaceAll("@TypeOf(writer).Error!", "std.Io.Writer.Error!");
  // consider: .replaceAll("writer: anytype", "writer: *std.Io.Writer") - looks like it has some false-positives
}

// Check for local changes in git before proceeding
const statusOutput = await $`git status --porcelain`.text();

if (statusOutput.trim().length > 0) {
  console.error("There are local changes in git. Please commit or stash them before running this migration.");
  console.error("Git status:");
  console.error(statusOutput);
  process.exit(1);
}

const exitCode = await Bun.spawn({
  cmd: ["./vendor/zig/zig", "fmt", "src"],
  stdio: ["inherit", "inherit", "inherit"],
}).exited;
if (exitCode !== 0) {
  console.error("zig fmt failed");
  process.exit(exitCode);
}

const files = await readdir("src", { recursive: true });

for (const file of files) {
  const path = "src/" + file;
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (e) {
    continue;
  }
  const replaced = replacements(text);
  if (replaced !== text) {
    if (!file.endsWith(".zig")) {
      console.warn("non-zig file changed: " + path);
    }
    await Bun.write(path, replaced);
  }
}

await $`git add --all && git commit -m "MIGRATE"`;
