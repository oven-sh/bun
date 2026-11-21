import zlib from "node:zlib";
import os from "node:os";
globalThis.startChain("g " + typeof zlib.gzipSync + " " + typeof os.EOL);
