import fs from "node:fs";

const scannerModuleName = "__SCANNER_MODULE__";
const suppressError = __SUPPRESS_ERROR__;

type IPCMessage =
  | { type: "result"; advisories: Bun.Security.Advisory[] }
  | { type: "error"; code: "MODULE_NOT_FOUND"; module: string }
  | { type: "error"; code: "INVALID_VERSION"; message: string }
  | { type: "error"; code: "SCAN_FAILED"; message: string };

// On Windows, NODE_CHANNEL_FD is set and process.send is available.
// On POSIX, we use raw fd access (fd 3 for output, fd 4 for input).
const useNodeIPC = typeof process.send === "function";

const IPC_PIPE_FD = 3;
const JSON_PIPE_FD = 4;

function sendAndExit(message: IPCMessage): never {
  if (useNodeIPC) {
    process.send!(message);
  } else {
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
  }
  process.exit(message.type === "error" ? 1 : 0);
}

let packages: Bun.Security.Package[];

if (useNodeIPC) {
  // Windows: Receive packages via NODE_CHANNEL_FD IPC
  packages = await new Promise<Bun.Security.Package[]>((resolve, reject) => {
    process.once("message", (data: unknown) => {
      if (!Array.isArray(data)) {
        reject(new Error("Expected packages to be an array"));
        return;
      }
      resolve(data as Bun.Security.Package[]);
    });
    process.once("disconnect", () => {
      reject(new Error("IPC channel closed before receiving packages"));
    });
  });
} else {
  // POSIX: Read packages from fd 4
  let packagesJson: string = "";
  try {
    packagesJson = await Bun.file(JSON_PIPE_FD).text();
  } catch (error) {
    const message = `Failed to read packages from FD ${JSON_PIPE_FD}: ${error instanceof Error ? error.message : String(error)}`;
    sendAndExit({
      type: "error",
      code: "SCAN_FAILED",
      message,
    });
  }

  try {
    packages = JSON.parse(packagesJson);
    if (!Array.isArray(packages)) {
      throw new Error("Expected packages to be an array");
    }
  } catch (error) {
    const message = `Failed to parse packages JSON: ${error instanceof Error ? error.message : String(error)}`;
    sendAndExit({
      type: "error",
      code: "SCAN_FAILED",
      message,
    });
  }
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

    sendAndExit({
      type: "error",
      code: "MODULE_NOT_FOUND",
      module: scannerModuleName,
    });
  } else {
    sendAndExit({
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
    sendAndExit({
      type: "error",
      code: "INVALID_VERSION",
      message: `Security scanner must be version 1, got version ${scanner.version}`,
    });
  }

  if (typeof scanner.scan !== "function") {
    throw new Error(`scanner.scan is not a function, got ${typeof scanner.scan}`);
  }

  const result = await scanner.scan({ packages });

  if (!Array.isArray(result)) {
    throw new Error("Security scanner must return an array of advisories");
  }

  sendAndExit({ type: "result", advisories: result });
} catch (error) {
  if (!suppressError) {
    console.error(error);
  }

  sendAndExit({
    type: "error",
    code: "SCAN_FAILED",
    message: error instanceof Error ? error.message : "Unknown error occurred",
  });
}
