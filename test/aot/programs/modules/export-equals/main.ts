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
