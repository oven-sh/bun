// Whatever key require.cache and Module._cache list can be read, and what is read is a module with its exports: after modules of every kind were loaded, some of the program and one from the disk.
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join } = require("node:path");
const Module = require("node:module");

console.log(require("./common.cjs").kind, require("./standard.mjs").kind, require("./typed.ts").kind, require("./data.json").kind);

const folder = mkdtempSync(join(tmpdir(), "listed-keys-"));
const onDisk = join(folder, "written-at-run-time.json");
writeFileSync(onDisk, '{ "kind": "from the disk" }\n');
try {
  console.log(require(onDisk).kind);
  for (const [name, cache] of [["require.cache", require.cache], ["Module._cache", Module._cache]]) {
    const failures = [];
    const ways = {
      "Object.keys": Object.keys(cache),
      "Reflect.ownKeys": Reflect.ownKeys(cache),
      "for-in": (() => { const keys = []; for (const key in cache) keys.push(key); return keys; })(),
      "Object.entries": Object.entries(cache).map(([key]) => key),
    };
    for (const [way, keys] of Object.entries(ways)) {
      for (const key of keys) {
        try {
          const found = cache[key];
          if (typeof found !== "object" || found === null || !("exports" in found)) failures.push(way + ": " + basename(key) + " is " + typeof found);
          else if (!(key in cache) || !Object.hasOwn(cache, key) || Object.getOwnPropertyDescriptor(cache, key) === undefined) failures.push(way + ": " + basename(key) + " is listed and is not there");
        } catch (error) {
          failures.push(way + ": " + basename(key) + " threw " + error.message);
        }
      }
      console.log(name, way, "lists the file from the disk:", keys.includes(onDisk));
    }
    console.log(name, "keys that cannot be read:", failures.length === 0 ? "none" : failures.join("; "));
    console.log(name, "the file from the disk:", cache[onDisk].exports.kind);
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
