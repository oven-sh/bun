// An ES module imports names of a CommonJS module that re-exports others, `export * from` as TypeScript emits it, two levels of it. What it binds is what the getters of the bindings answer when the
// module is first imported, and so is what a namespace object lists later. No getter, no accessor and no property is made for any of the names.
// COUNTER: StarsRecorded >= 3
// COUNTER: StarsCarriedOutLate = 0
import outerDefault, { one, two, shared, own, change } from "./outer.cjs";
import { one as middleOne, own as middleOwn } from "./middle.cjs";
const list = (names) => Object.keys(names).map((key) => key + "=" + (typeof names[key] === "object" ? "object" : typeof names[key] === "function" ? "function" : names[key])).join(" ");
console.log(one, "|", two, "|", shared, "|", own, "|", typeof change, "|", typeof outerDefault);
console.log(middleOne, "|", middleOwn);
change();
console.log(one, "|", middleOne);
console.log(list(await import("./outer.cjs")));
console.log(list(await import("./middle.cjs")));
console.log(list(await import("./first.cjs")));
