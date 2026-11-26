import { createRequire } from "node:module";
const own = createRequire(import.meta.url);
const made = createRequire(process.cwd() + "/absent.js");
const flag = process.argv.length > 99;
export default () => [
  own("os").platform(),
  made("os").platform(),
  made("node:os").platform(),
  made(flag ? "path" : "os").platform(),
  made(flag ? "node:path" : "node:os").platform(),
  createRequire(process.cwd() + "/absent.js")("os").platform(),
];
