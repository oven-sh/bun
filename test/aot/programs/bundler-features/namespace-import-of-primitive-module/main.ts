// `import * as all` of a module whose value is a string, a number, a boolean or null: a text file, a file imported for its path, a JSON file
// that holds a scalar, a CommonJS module that exports one. What runs has a namespace object with `default`, so that is its type.
// The executable lists what `bun run` lists, but for the file imported for its path: plain Bun lists `__esModule` beside `default` there, the executable `default` alone. That line is stored.
/// <reference path="./files/types.d.ts" />
import * as text from "./files/words.txt"
import * as note from "./files/note.md" with { type: "text" }
import * as file from "./files/data.bin" with { type: "file" }
import * as jsonString from "./files/string.json"
import * as jsonNumber from "./files/number.json"
import * as jsonNull from "./files/null.json"
import * as jsonTrue from "./files/true.json"
import * as commonjsString from "./files/text.cjs"
import * as commonjsNumber from "./files/number.cjs"
import words from "./files/words.txt"
import { default as again } from "./files/words.txt"
import { reexported } from "./middle"
function keys(value: object) { return Object.keys(value).join() }
function length(value: { default: string }) { return value.default.length }
console.log(typeof text, keys(text), JSON.stringify(text.default), length(text), "default" in text, JSON.stringify(text), JSON.stringify({ ...text }))
console.log(typeof note, keys(note), JSON.stringify(note.default))
console.log(typeof file, keys(file), typeof file.default, file.default.endsWith(".bin"))
console.log(typeof jsonString, keys(jsonString), JSON.stringify(jsonString.default))
console.log(typeof jsonNumber, keys(jsonNumber), jsonNumber.default + 1, typeof jsonNull, keys(jsonNull), jsonNull.default, typeof jsonTrue, jsonTrue.default === true)
console.log(typeof commonjsString, keys(commonjsString), JSON.stringify(commonjsString.default), typeof commonjsNumber, commonjsNumber.default + 1)
console.log(text.default === words, words === again, words.length, typeof reexported, keys(reexported), reexported.default.trim())
const seen: unknown = text
console.log(typeof seen, seen !== null && typeof seen === "object" && "default" in seen ? seen.default : "no default")
