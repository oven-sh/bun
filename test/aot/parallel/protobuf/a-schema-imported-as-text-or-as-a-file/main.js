// The type attribute of an import gets the text or the path of a .proto file, whatever the file holds.
import { readFileSync } from "node:fs";
import text from "./broken.proto" with { type: "text" };
import path from "./valid.proto" with { type: "file" };
import { typeName } from "./compiled.js";

console.log(text, readFileSync(path, "utf8"), typeName);
