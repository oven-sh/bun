import { isDate, isMap, isSet } from "node:util/types";
import { Buffer, kMaxLength } from "node:buffer";
import { platform, argv } from "node:process";
import { O_RDONLY, O_WRONLY } from "node:constants";
import { StringDecoder } from "node:string_decoder";
import { heapSize, heapStats } from "bun:jsc";

const describe = value => (typeof value === "function" ? "function " + value.name : typeof value + " " + String(value));
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
};
export const answers = [
  "isDate: " + describe(isDate) + ": " + attempt(() => isDate(new Date(0))),
  "isMap: " + describe(isMap) + ": " + attempt(() => isMap(new Map())),
  "isSet: " + describe(isSet) + ": " + attempt(() => isSet(new Set())),
  "Buffer: " + describe(Buffer) + ": " + attempt(() => Buffer.byteLength("abc")),
  "kMaxLength: " + typeof kMaxLength,
  "platform: " + describe(platform),
  "argv: " + Array.isArray(argv),
  "StringDecoder: " + describe(StringDecoder),
  "heapSize: " + describe(heapSize) + ": " + typeof attempt(() => heapSize()),
  "heapStats: " + describe(heapStats) + ": " + typeof attempt(() => heapStats()),
  "O_RDONLY: " + describe(O_RDONLY),
  "O_WRONLY: " + describe(O_WRONLY),
];
