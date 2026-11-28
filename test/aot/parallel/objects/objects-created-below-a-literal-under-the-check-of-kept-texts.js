// Object.create() of a literal of methods is compiled as a construction. The text that the function keeps still says Object.create.
// Under: --aot-check=Validate: the text of a function is read back beside its tree
"use strict";
const shelf = { tagOf() { return this.tag; } };
function make(tag, kind) { const made = Object.create(shelf); made.tag = tag; if (kind) made.kind = kind; return made; }
function below(above, tag) { const made = Object.create(above); made.tag = tag; return made; }
const first = make("first", "k"), second = below(first, "second");
console.log(first.tagOf(), second.tagOf(), second.kind, Object.keys(second).join(), Object.getPrototypeOf(first) === shelf);
console.log(String(make).includes("Object.create(shelf)"));
