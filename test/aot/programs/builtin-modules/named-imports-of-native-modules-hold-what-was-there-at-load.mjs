// A named import of a module that native code makes holds what the module's object held when the module was loaded, as one of a module written in JavaScript does. A store to the object afterward changes the object alone: also for a call, a `new`, a member of a star and a name that is exported again.
import process, { cwd, hrtime, nextTick, emitWarning, exit, argv, env, exitCode, title, platform, features } from "node:process";
import buffer, { Buffer, atob, isUtf8, INSPECT_MAX_BYTES, kMaxLength, constants } from "node:buffer";
import module, { createRequire, builtinModules, isBuiltin } from "node:module";
import types, { isDate, isPromise } from "node:util/types";
import decoder, { StringDecoder } from "node:string_decoder";
import * as processStar from "node:process";
import * as bufferStar from "node:buffer";
import * as typesStar from "node:util/types";
export { cwd as exportedAgain, INSPECT_MAX_BYTES as numberExportedAgain } from "./named-imports-of-native-modules-hold-what-was-there-at-load.mjs";
export { cwd, INSPECT_MAX_BYTES };
import * as self from "./named-imports-of-native-modules-hold-what-was-there-at-load.mjs";

const lines = [];
function during(object, name, value, look) {
  const original = object[name];
  object[name] = value;
  let seen;
  try {
    seen = look();
  } finally {
    object[name] = original;
  }
  lines.push(name + ": " + seen.join(" "));
}
const replaced = () => "replaced";
const directory = cwd();

during(process, "cwd", replaced, () => [cwd() === directory, processStar.cwd() === directory, self.cwd() === directory, self.exportedAgain() === directory, process.cwd()]);
during(process, "hrtime", replaced, () => [Array.isArray(hrtime()), typeof hrtime.bigint(), Array.isArray(processStar.hrtime()), process.hrtime()]);
during(process, "nextTick", replaced, () => [nextTick(() => lines.push("the tick ran")), processStar.nextTick === nextTick, process.nextTick()]);
during(process, "emitWarning", replaced, () => [emitWarning === replaced, processStar.emitWarning === replaced, process.emitWarning()]);
during(process, "exit", replaced, () => [exit === replaced, processStar.exit === replaced, process.exit()]);
during(process, "argv", ["stored"], () => [argv.length > 1, processStar.argv === argv, process.argv.length]);
during(process, "env", { only: "this" }, () => ["only" in env, processStar.env === env, Object.keys(process.env).join()]);
during(process, "exitCode", 0, () => [exitCode, processStar.exitCode, process.exitCode]);
during(process, "title", "stored", () => [title === "stored", processStar.title === title, process.title]);
during(process, "platform", "stored", () => [platform === "stored", processStar.platform === platform, process.platform]);
during(process, "features", { stored: "1" }, () => [typeof features.tls, processStar.features === features, Object.keys(process.features).join()]);
process.exitCode = undefined;

during(buffer, "Buffer", class Stored {}, () => [Buffer.from("text").toString(), new Buffer(2).length, Buffer.isBuffer(Buffer.alloc(1)), bufferStar.Buffer === Buffer, buffer.Buffer.name]);
during(buffer, "atob", replaced, () => [atob("dGV4dA=="), bufferStar.atob("dGV4dA=="), buffer.atob()]);
during(buffer, "isUtf8", replaced, () => [isUtf8(Buffer.from("text")), bufferStar.isUtf8(Buffer.from([0xff])), buffer.isUtf8()]);
during(buffer, "INSPECT_MAX_BYTES", 1000, () => [INSPECT_MAX_BYTES, bufferStar.INSPECT_MAX_BYTES, self.INSPECT_MAX_BYTES, self.numberExportedAgain, buffer.INSPECT_MAX_BYTES]);
during(buffer, "kMaxLength", 7, () => [kMaxLength > 7, bufferStar.kMaxLength === kMaxLength, buffer.kMaxLength]);
during(buffer, "constants", { stored: 1 }, () => [typeof constants.MAX_LENGTH, bufferStar.constants === constants, Object.keys(buffer.constants).join()]);

during(module, "createRequire", replaced, () => [createRequire(import.meta.url)("node:path").sep, module.createRequire()]);
during(module, "builtinModules", ["stored"], () => [builtinModules.includes("fs"), module.builtinModules.length]);
during(module, "isBuiltin", replaced, () => [isBuiltin("node:fs"), isBuiltin("no-such-module"), module.isBuiltin()]);
during(types, "isDate", replaced, () => [isDate(new Date(0)), isDate({}), typesStar.isDate(new Date(0)), types.isDate()]);
during(types, "isPromise", replaced, () => [isPromise(Promise.resolve()), typesStar.isPromise(1), types.isPromise()]);
during(decoder, "StringDecoder", class Stored {}, () => [new StringDecoder("utf8").write(Buffer.from("text")), decoder.StringDecoder.name]);

await new Promise(resolve => setImmediate(resolve));
console.log(lines.join("\n"));
