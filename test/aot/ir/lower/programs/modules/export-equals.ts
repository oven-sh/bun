// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 8

// FILE: main.ts
// `export = value`: what every kind of importer gets is that value.
import one = require("./number")
import oneByDefault from "./number"
import add = require("./function")
import addByDefault from "./function"
import twice = require("./arrow")
import Kept = require("./class")
import KeptByDefault from "./class"
import table = require("./object")
import tableByDefault from "./object"
import literal = require("./literal")
import made from "./made"
console.log(one, oneByDefault, require("./number"), (await import("./number")).default)
console.log(add(1), addByDefault(2), add === addByDefault, add === require("./function"), add.name, (await import("./function")).default(3))
console.log(twice(4), (await import("./arrow")).default(5), (require("./arrow") as typeof twice)(6))
console.log(new Kept().v, Kept.s, Kept === KeptByDefault, new KeptByDefault() instanceof Kept, Kept.name)
console.log(table.a + table.b, table.sum(), table === tableByDefault, table === require("./object"), (await import("./object")).default.sum())
console.log(literal.a, literal.list.length, made.made, (await import("./made")).default === made)

// FILE: arrow.ts
const twice = (n: number) => n * 2
export = twice

// FILE: class.ts
class Kept { v = 5; static s = 6 }
export = Kept

// FILE: function.ts
function add(n: number) { return n + 1 }
export = add

// FILE: literal.ts
export = { a: 1, list: [1, 2] }

// FILE: made.ts
function make() { return { made: true } }
export = make()

// FILE: number.ts
console.log("number runs")
export = 1

// FILE: object.ts
const table = { a: 1, b: "s", sum() { return this.a + 1 } }
export = table

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
