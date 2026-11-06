const { attempt } = require("./show.cjs");
const maker = require("./maker.cjs");
const reader = require("./reader.cjs");
const strictReader = require("./strict-reader.mjs");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function all(when) {
  for (const name in reader) attempt(when + " sloppy " + name, reader[name]);
  for (const name of ["next", "kind", "size"]) attempt(when + " strict " + name, strictReader[name]);
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += maker.bump() + reader.next() + reader.size() + strictReader.next() + strictReader.size();
console.log("sum", sum);
maker.replaceRegistry([1]);
all("numbers");
maker.become("a text");
maker.replaceRegistry("a text");
all("texts");
maker.become({ valueOf: () => 41 });
maker.replaceRegistry({ length: -1, push: () => "own push" });
all("objects");
maker.become(10n);
maker.replaceRegistry(null);
all("a bigint and null");
attempt("a store by a strict module", strictReader.store);
attempt("a store to an undeclared name by a strict module", strictReader.storeUndeclared);
attempt("removed", maker.remove);
all("removed");
attempt("made again", maker.bump);
