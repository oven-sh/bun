// An error that a native function makes lists that function first in its stack, whoever calls it: the program, or the JavaScript of a module of the runtime.
import fs from "node:fs";
import zlib from "node:zlib";

function namesIn(error) {
  const names = String(error.stack)
    .split("\n")
    .slice(1, 4)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*$/, ""));
  return names.map(name => (/[\\/:]/.test(name) ? "<file>" : name)).join(" < ");
}

function attempt(name, run) {
  try {
    run();
    console.log(name + ": returned");
  } catch (error) {
    console.log(name + ": " + error.name + " " + (error.code ?? "") + " | " + namesIn(error));
  }
}

const missing = "/nonexistent-directory/entry";
const decoder = new TextDecoder("utf-8", { fatal: true });
const invalid = new Uint8Array([0xff, 0xfe]);
for (let turn = 0; turn < 3; turn++) {
  attempt("opendirSync", () => fs.opendirSync(missing));
  attempt("watch", () => fs.watch(missing));
  attempt("statSync", () => fs.statSync(missing));
  attempt("lstatSync", () => fs.lstatSync(missing));
  attempt("readFileSync", () => fs.readFileSync(missing));
  attempt("readdirSync", () => fs.readdirSync(missing));
  attempt("realpathSync", () => fs.realpathSync(missing));
  attempt("cpSync", () => fs.cpSync(missing, missing + "-copy"));
  attempt("rmSync", () => fs.rmSync(missing));
  attempt("openSync", () => fs.openSync(missing));
  attempt("accessSync", () => fs.accessSync(missing));
  attempt("mkdtempSync", () => fs.mkdtempSync(missing));
  attempt("decode", () => decoder.decode(invalid));
  attempt("atob", () => atob("***"));
  attempt("structuredClone", () => structuredClone(() => {}));
  attempt("chdir", () => process.chdir(missing));
  attempt("gunzipSync", () => Bun.gunzipSync(invalid));
  attempt("inflateSync", () => zlib.inflateSync(invalid));
  attempt("fileURLToPath", () => Bun.fileURLToPath("http://example.com/"));
  attempt("Buffer.alloc", () => Buffer.alloc(-1));
  attempt("toString", () => Buffer.from("text").toString("no-such-encoding"));
}
