// The loader keeps one entry for every import type but "json", and require() of a path asks that entry first.
import json from "./data.json" with { type: "json" };
import text from "./data.json" with { type: "text" };
import { read } from "./reader.cjs";
console.log(typeof json, typeof text);
for (const name of ["./data.json", "./data.json", "./absent.json"]) {
  try {
    console.log(name, read(name));
  } catch (error) {
    console.log(name, error.code);
  }
}
