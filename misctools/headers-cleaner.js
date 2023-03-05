// this file is intended to be runnable both from node and bun
var { readFileSync, writeFileSync } = require("fs");
var { join } = require("path");

const destination = join(__dirname, "../src/bun.js/bindings/headers.zig");
const replacements = join(__dirname, "../src/bun.js/bindings/headers-replacements.zig");

console.log("Writing to", destination);
var output = "// GENERATED CODE - DO NOT MODIFY BY HAND\n\n";
var input = readFileSync(destination, "utf8");

const first_extern = input.indexOf("extern fn");
const first_extern_line = input.indexOf("\n", first_extern - 128);
const last_extern_fn = input.lastIndexOf("extern");
const last_extern_fn_line = input.indexOf("\n", last_extern_fn);
const keep = (input.substring(0, first_extern_line) + input.substring(last_extern_fn_line))
  .split("\n")
  .filter(a => /const (JSC|WTF|Web)_/gi.test(a) && !a.includes("JSValue") && !a.includes("CatchScope"))
  .join("\n")
  .trim();

input = keep + input.slice(first_extern_line, last_extern_fn_line);
input = input.replaceAll("*WebCore__", "*bindings.");
input = input.replaceAll("*JSC__", "*bindings.");
input = input.replaceAll("[*c] JSC__", "[*c]bindings.");
input = input.replaceAll("[*c]JSC__", "[*c]bindings.");
input = input.replaceAll("[*c]bindings.JSGlobalObject", "*bindings.JSGlobalObject");
input = input.replaceAll("[*c]bindings.JSPromise", "?*bindings.JSPromise");
input = input.replaceAll("[*c]const bindings.JSPromise", "?*const bindings.JSPromise");

input = input.replaceAll("[*c] const JSC__", "[*c]const bindings.");
input = input.replaceAll("[*c]Inspector__ScriptArguments", "[*c]bindings.ScriptArguments");

input = input
  .replaceAll("VirtualMachine", "bindings.VirtualMachine")
  .replaceAll("bindings.bindings.VirtualMachine", "bindings.VirtualMachine");

input = input.replaceAll("?*JSC__JSGlobalObject", "*bindings.JSGlobalObject");
input = input.replaceAll("?*bindings.CallFrame", "*bindings.CallFrame");
input = input.replaceAll("[*c]bindings.VM", "*bindings.VM");

const hardcode = {
  "[*c][*c]JSC__Exception": "*?*JSC__Exception     ",
  "[*c]?*anyopaque": "[*c]*anyopaque",
  "[*c]JSC__JSGlobalObject": "?*JSC__JSGlobalObject",
};

for (let key in hardcode) {
  const value = hardcode[key];
  input = input.replaceAll(key, value);
}

const remove = [
  "pub const __darwin",
  "pub const _",
  "pub const __builtin",
  "pub const int",
  "pub const INT",
  "pub const uint",
  "pub const UINT",
  "pub const WCHAR",
  "pub const wchar",
  "pub const intmax",
  "pub const INTMAX",
  "pub const uintmax",
  "pub const UINTMAX",
  "pub const max_align_t",
  "pub const ZigErrorCode",
  "pub const JSClassRef",
  "pub const __",
];
var lines = input.split("\n");
for (let prefix of remove) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(prefix)) {
      lines[i] = "";
    }
  }
}
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes("struct_")) {
    lines[i] = "";
    continue;
  }
}
input = lines.filter(a => a.length > 0).join("\n");

writeFileSync(destination, output + "\n" + readFileSync(replacements, "utf8").trim() + "\n" + input.trim() + "\n");
