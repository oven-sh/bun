import { gzipSync } from "node:zlib";
import { EOL } from "node:os";
globalThis.startChain("h " + typeof gzipSync + " " + typeof EOL);
