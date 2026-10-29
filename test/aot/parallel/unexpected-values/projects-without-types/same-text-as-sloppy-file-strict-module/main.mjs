import sloppy from "./body.cjs";
import * as strict from "./body.mjs";
import shown from "./show.cjs";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const { attempt } = shown;
const receivers = { nothing: undefined, none: null, number: 5, text: "abc", yes: true, big: 5n, symbol: Symbol.iterator, object: { a: 1 } };
for (const [mode, body] of Object.entries({ sloppy, strict })) {
  for (const name of Object.keys(sloppy)) {
    if (typeof body[name] !== "function" || name === "self") continue;
    const callee = body[name];
    attempt(mode + " " + name, () => callee([1, 2], 2));
    attempt(mode + " " + name + " as a method", () => body[name]([1, 2], 2));
  }
  for (const receiver in receivers) {
    attempt(mode + " self.call(" + receiver + ")", () => {
      const self = body.self.call(receivers[receiver]);
      return [typeof self, self === receivers[receiver], self === globalThis];
    });
  }
}
for (let i = 0; i < 2000; i++) {
  sloppy.addUp(1, 2);
  strict.addUp(1, 2);
  sloppy.lengthOfFirst([1]);
  strict.lengthOfFirst([1]);
}
attempt("after 2000 calls", () => [sloppy.addUp(1, 2), strict.addUp(1, 2), sloppy.lengthOfFirst([1]), strict.lengthOfFirst([1])]);
