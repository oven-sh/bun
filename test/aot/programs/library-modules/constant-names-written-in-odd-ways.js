// Each of these names is a constant, although it is not a plain string in the parentheses. Each module is asked for again under a computed name: it is in. The output is that of plain Bun.
const viaConstant = "node:readline";

const loaded = [
  require(("node:dgram")),
  require(`node:zlib`),
  require("node:" + "tty"),
  require(viaConstant),
  await import("node:dns"),
  process.getBuiltinModule("node:querystring"),
  import.meta.require("node:string_decoder"),
];
function later() {
  return require("node:punycode");
}
class Holder {
  method() {
    return require("node:assert");
  }
}
try {
  loaded.push(require("node:diagnostics_channel"));
} catch {}
loaded.push(later(), new Holder().method());
console.log(loaded.map(value => typeof value).join());

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, error.code);
  }
}
