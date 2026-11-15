import callable from "./kinds/callable.cjs";
import heir from "./kinds/heir.cjs";
import like from "./kinds/like.cjs";
import list from "./kinds/list.cjs";
import nothing from "./kinds/nothing.cjs";
import number from "./kinds/number.cjs";
import text from "./kinds/text.cjs";
import throughThis from "./kinds/through-this.cjs";
import untouched from "./kinds/untouched.cjs";
import { attempt } from "./show.js";
import * as use from "./use.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

let sum = 0;
for (let i = 0; i < 2000; i++) sum += use.size(list) + use.first(list) + use.doubled(list)[2] + use.total(list) + use.plusOne(list).length + use.text(list).length;
console.log("sum", sum);

attempt("seen size(text)", () => use.size(text));
attempt("seen doubled(text)", () => use.doubled(text));
attempt("seen total(number)", () => use.total(number));
attempt("seen first(nothing)", () => use.first(nothing));
const kinds = { list, text, number, nothing, like, callable, heir, untouched, throughThis };
for (const kind in kinds) for (const name in use) attempt(name + "(" + kind + ")", () => use[name](kinds[kind]));
