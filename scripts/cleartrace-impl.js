import { createInterface } from "node:readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

const ignore = [
  " print__anon_",
  " printError__anon_",
  " printErrorln__anon_",
  " prettyWithPrinter__anon_",
  " prettyErrorLn__anon_",
  " err [inlined]",
  " createErrorInstance__anon_",
  " allocPrint__anon_",
  " createFormat__anon_",
  " fmt__anon_",
  " toInvalidArguments__anon_",
  " throwInvalidArguments__anon_",
  " printStringPretty__anon_",
  " throwErrInvalidArgType",
  " validateObject__",
  " allocPrint ",
  " addWarningFmt_",
  "logger.zig", // maybe?
  "output.zig", // might be overly optimistic
  "vendor/zig/lib/std",
  "ErrorCode.zig",
];

let skipNext = false;
rl.on("line", line => {
  if (skipNext) {
    skipNext = false;
    return;
  }
  if (line.includes(": error: ")) {
    console.log("\x1b[31m" + line.replace(/^vendor\/zig\/lib\/std\/Io\/Writer\.zig:\d+:\d+: /, "") + "\x1b[0m");
  } else if (line.includes(": note: ")) {
    console.log("\x1b[36m" + line + "\x1b[0m");
  } else if (line.includes('@compileError("')) {
    skipNext = true;
  } else if (ignore.some(q => line.includes(q) && !line.includes(" format:"))) {
    console.log("\x1b[2m" + line + "\x1b[0m");
  } else {
    console.log(line);
  }
});

rl.on("close", () => {
  process.exit(0);
});
