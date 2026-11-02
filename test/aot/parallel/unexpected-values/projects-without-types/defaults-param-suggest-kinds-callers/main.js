import { honest } from "./honest.js";
import * as library from "./library.js";
import { values } from "./others.js";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

attempt("honest", honest);
for (let i = 0; i < 2000; i++) honest();
attempt("seen next(text)", () => library.next("7"));
attempt("seen size(text)", () => library.size("word"));
attempt("seen shout(number)", () => library.shout(5));
for (const use in library) for (const value in values) attempt(use + "(" + value + ")", () => library[use](values[value], values[value]));
attempt("honest again", honest);
