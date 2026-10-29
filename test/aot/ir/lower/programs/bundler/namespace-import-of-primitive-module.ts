// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 2
// STATISTIC: SourceFilesData = 7

// FILE: main.ts
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

// FILE: files/data.bin
bytes
// FILE: files/note.md
# a note
more
// FILE: files/null.json
null

// FILE: files/number.cjs
module.exports = 42;

// FILE: files/number.json
42

// FILE: files/string.json
"just a string"

// FILE: files/text.cjs
module.exports = "from commonjs";

// FILE: files/true.json
true

// FILE: files/types.d.ts
declare module "*.md" { const text: string; export default text }
declare module "*.bin" { const path: string; export default path }

// FILE: files/words.txt
some words
// FILE: middle.ts
import * as reexported from "./files/words.txt"
export { reexported }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: keys length
// CHECK-LABEL: function {{*}}name="keys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="default"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = PropGet v2 key="length"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
