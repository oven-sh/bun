import fs from "node:fs";

const scannerModuleName = "__SCANNER_MODULE__";
const suppressError = __SUPPRESS_ERROR__;

type IPCMessage =
  | { type: "result"; advisories: Bun.Security.Advisory[] }
  | { type: "error"; code: "MODULE_NOT_FOUND"; module: string }
  | { type: "error"; code: "INVALID_VERSION"; message: string }
  | { type: "error"; code: "SCAN_FAILED"; message: string };

const IPC_PIPE_FD = 3;
const DATA_PIPE_FD = 4;

function writeAndExit(message: IPCMessage): never {
  const data = JSON.stringify(message);

  for (let remaining = data; remaining.length > 0; ) {
    const written = fs.writeSync(IPC_PIPE_FD, remaining);

    if (written === 0) {
      console.error("Failed to write to IPC pipe");
      process.exit(1);
    }
    remaining = remaining.slice(written);
  }

  fs.closeSync(IPC_PIPE_FD);

  process.exit(message.type === "error" ? 1 : 0);
}

let scanner: Bun.Security.Scanner;

try {
  scanner = (await import(scannerModuleName)).scanner;
} catch (error) {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
    if (!suppressError) {
      const msg = `\x1b[31merror: \x1b[0mFailed to import security scanner: \x1b[1m'${scannerModuleName}'`;
      console.error(msg);
    }

    writeAndExit({
      type: "error",
      code: "MODULE_NOT_FOUND",
      module: scannerModuleName,
    });
  } else {
    writeAndExit({
      type: "error",
      code: "SCAN_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

try {
  if (typeof scanner !== "object" || scanner === null || typeof scanner.version !== "string") {
    throw new Error("Security scanner must export a 'scanner' object with a version property");
  }

  if (scanner.version !== "1") {
    writeAndExit({
      type: "error",
      code: "INVALID_VERSION",
      message: `Security scanner must be version 1, got version ${scanner.version}`,
    });
  }

  if (typeof scanner.scan !== "function") {
    throw new Error(`scanner.scan is not a function, got ${typeof scanner.scan}`);
  }

  // Read package data from the data pipe (fd 4) to avoid command-line arg length limits
  let packages: Bun.Security.Package[];
  try {
    const packagesJson = fs.readFileSync(DATA_PIPE_FD, "utf8");
    fs.closeSync(DATA_PIPE_FD);
    packages = JSON.parse(packagesJson);
    if (!Array.isArray(packages)) {
      throw new Error("Expected packages to be an array");
    }
  } catch (error) {
    writeAndExit({
      type: "error",
      code: "SCAN_FAILED",
      message: `Failed to read packages from data pipe: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const result = await scanner.scan({ packages });

  if (!Array.isArray(result)) {
    throw new Error("Security scanner must return an array of advisories");
  }

  writeAndExit({ type: "result", advisories: result });
} catch (error) {
  if (!suppressError) {
    console.error(error);
  }

  writeAndExit({
    type: "error",
    code: "SCAN_FAILED",
    message: error instanceof Error ? error.message : "Unknown error occurred",
  });
}
