// A file says that nothing is lost without it, a barrel hands its names on by `export *` and also names it in an import() or a require(), and somebody takes a name of it by `export { a } from` the barrel.
// That is an import like any other: the file runs with whoever takes the name, and not only when the call is made. The host reads the default of the entry point behind its body.
export { constant as default } from "./barrel-of-the-constant.mjs";
import * as handsOn from "./hands-on.mjs";
const key = process.argv.length > 99 ? "none" : "variable";
const attempt = (how, read) => {
  try {
    console.log(how + ":", read());
  } catch (error) {
    console.log(how + ":", error.name);
  }
};
attempt("a class, by name off the namespace", () => typeof handsOn.Class);
attempt("a let, under a key nobody follows", () => handsOn[key]);
attempt("through a star and then by name", () => handsOn.throughTwo(1));
attempt("the names", () => Object.keys(handsOn).join());
console.log("end");
