// bun generate.ts <a clone of github.com/nst/JSONTestSuite>: writes files.json (each file of test_parsing and test_transform in base64, because many are not UTF-8; a long file that repeats a few bytes is stored as those bytes, a count and what follows) and fitted.ts (for each file that JSON.parse accepts, a type written to fit its value). No script of that repository is run.
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const clone = process.argv[2];
const files: Record<string, Buffer> = {};
for (const folder of ["test_parsing", "test_transform"]) for (const name of readdirSync(join(clone, folder)).sort()) files[folder + "/" + name] = readFileSync(join(clone, folder, name));
function stored(bytes: Buffer): string | { repeat: string; times: number; then: string } {
  for (let length = 1; length <= 16 && bytes.length >= 1000; length++) {
    const times = Math.floor(bytes.length / length);
    if (bytes.subarray(0, times * length).equals(Buffer.alloc(times * length, bytes.subarray(0, length)))) return { repeat: bytes.subarray(0, length).toString("base64"), times, then: bytes.subarray(times * length).toString("base64") };
  }
  return bytes.toString("base64");
}
writeFileSync(join(import.meta.dir, "files.json"), "{\n" + Object.entries(files).map(([name, bytes]) => JSON.stringify(name) + ": " + JSON.stringify(stored(bytes))).join(",\n") + "\n}\n");

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  if (Array.isArray(value)) return value.length === 0 ? "unknown[]" : value.length <= 6 ? "[" + value.map(typeOf).join(", ") + "]" : "(" + [...new Set(value.map(typeOf))].join(" | ") + ")[]";
  return "{ " + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + ": " + typeOf((value as any)[key])).join("; ") + " }";
}
const types: string[] = [];
const fits: Record<string, number> = {};
for (const [name, bytes] of Object.entries(files)) {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
  } catch {
    continue;
  }
  const type = typeOf(value);
  if (type.length > 400 || /\\ud[89a-f]/.test(type)) continue;
  if (!types.includes(type)) types.push(type);
  fits[name] = types.indexOf(type);
}
writeFileSync(
  join(import.meta.dir, "fitted.ts"),
  "// Written by generate.ts.\nexport const parsers: ((text: string) => unknown)[] = [\n" + types.map(type => "  text => JSON.parse(text) as " + type + ",\n").join("") + "];\nexport const fits: Record<string, number> = " + JSON.stringify(fits, null, 2) + ";\n",
);
