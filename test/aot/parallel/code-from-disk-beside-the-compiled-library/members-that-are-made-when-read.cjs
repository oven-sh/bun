// Files that are loaded at run time import members that a built-in module makes when they are first read. Other values take their places on the module's object before the files' first use of them.
// Flags: --aot-allow-code-from-disk
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "members-made-when-read-"));
const put = (name, text) => fs.writeFileSync(path.join(folder, name), text);

put("pass.mjs", `export { format as passed } from "node:util"; export * from "node:timers";`);
put(
  "replace.mjs",
  `
import util from "node:util"; import timers from "node:timers"; import fs from "node:fs"; import net from "node:net";
export const was = { inspect: util.inspect, format: util.format, strip: util.stripVTControlCharacters, promises: timers.promises, ReadStream: fs.ReadStream, BlockList: net.BlockList };
util.inspect = () => "replaced"; util.format = () => "replaced"; util.stripVTControlCharacters = undefined; timers.promises = 1; fs.ReadStream = class {}; net.BlockList = null;
`,
);
put(
  "reader.mjs",
  `
import util, { inspect } from "node:util"; import { passed, promises } from "./pass.mjs"; import { ReadStream } from "node:fs"; import { BlockList } from "node:net"; import * as all from "node:util";
import { was } from "./replace.mjs";
export const answers = [inspect === was.inspect, inspect(1), passed === was.format, promises === was.promises, ReadStream === was.ReadStream, BlockList === was.BlockList, all.inspect === inspect, util.inspect(1), typeof all.stripVTControlCharacters];
`,
);

(async () => {
  console.log((await import(path.join(folder, "reader.mjs"))).answers.join(" "));
  console.log((await import(path.join(folder, "reader.mjs") + "?again")).answers.slice(0, 2).join(" "));
  fs.rmSync(folder, { recursive: true });
})();
