import * as barrel from "./barrel.js";
import { change, current, lists, makeList, makeList2, makeText, old, texts } from "./outer-barrel.js";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const size = value => value.length;
const doubled = value => value.map(item => item * 2);
const last = value => value[value.length - 1];
let sum = 0;
for (let i = 0; i < 2000; i++) sum += size(makeList()) + doubled(makeList())[0] + last(makeList()) + size(current);
console.log("sum", sum);
attempt("keys of the barrel", () => Object.keys(barrel).join());
attempt("a name that two files export", () => [barrel.make, barrel.name, "make" in barrel]);
const makers = { makeList, makeText, makeList2, "lists.make": lists.make, "texts.make": texts.make, "old.make": old.make };
for (const name in makers) for (const [label, use] of Object.entries({ size, doubled, last })) attempt(label + "(" + name + "())", () => use(makers[name]()));
attempt("the binding behind two barrels", () => [size(current), last(current)]);
change("a text");
attempt("after it became a text", () => [size(current), last(current), barrel.current]);
change(undefined);
attempt("after it became undefined", () => size(current));
