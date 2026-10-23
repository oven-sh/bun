// `inner/` is written without `strict`, the program with it.
import { Declared, Stored } from "./inner/fields.js";
import { evens, last, first, anything } from "./inner/starts-empty.ts";
import { get, set, take } from "./inner/dictionary.js";
import { pick } from "./inner/index-by-string.ts";
import { size, later, sign, pick as spread } from "./inner/possibly-undefined.ts";
set("a", 1);
console.log(new Declared().count(), new Stored(), evens([1]), last(["a"]), first(["a"]), anything(), get("a"), take("a"), pick({ a: 1 }, "a"), size(new Map(), "a"), later(true), sign(1), spread({ a: 2 }));
