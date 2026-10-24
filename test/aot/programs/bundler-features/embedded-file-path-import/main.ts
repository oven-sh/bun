// A file is embedded in the executable and imported for its path.
/// <reference path="./asset/types.d.ts" />
import path from "./asset/data.bin" with { type: "file" }
import { readFileSync } from "node:fs"
console.log(typeof path, path.endsWith(".bin"), readFileSync(path, "utf8").trim())
