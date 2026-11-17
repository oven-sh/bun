// What an ES module binds of a CommonJS module is what the module exported when it was first imported, by Bun's rules: behind the __esModule mark the names that can be listed and the module's own
// `default`; without the mark every own name but `default`, which is the module itself. The names are bound one by one; the list of all of them is asked for late here, and holds the same values.
import markedDefault, { one as markedOne, two, change as changeMarked } from "./marked.cjs";
import withoutDefault, { only } from "./marked-without-default.cjs";
import plainDefault, { one as plainOne, hidden as plainHidden, change as changePlain } from "./plain.cjs";
import falseDefault, { one as falseOne, __esModule as falseMark } from "./marked-false.cjs";
import { one as barrelOne, only as barrelOnly } from "./barrel.mjs";
const list = (names) => Object.keys(names).map((key) => key + "=" + (typeof names[key] === "object" ? "{" + Object.keys(names[key]).join() + "}" : typeof names[key] === "function" ? "function" : names[key])).join(" ");
console.log(markedDefault, "|", markedOne, "|", two, "|", typeof changeMarked);
console.log(typeof withoutDefault, Object.keys(withoutDefault).join(), "|", only);
console.log(typeof plainDefault, Object.keys(plainDefault).join(), plainDefault.default, "|", plainOne, "|", plainHidden);
console.log(typeof falseDefault, Object.keys(falseDefault).join(), "|", falseOne, "|", falseMark);
console.log(barrelOne, "|", barrelOnly);
const marked = changeMarked();
const plain = changePlain();
console.log(marked.one, "|", markedOne, "|", plain.one, "|", plainOne, "|", plainDefault.one);
console.log(list(await import("./marked.cjs")));
console.log(list(await import("./marked-without-default.cjs")));
console.log(list(await import("./plain.cjs")));
console.log(list(await import("./marked-false.cjs")));
console.log(list(await import("./barrel.mjs")));
