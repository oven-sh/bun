// An object with 400,000 names, of which no type says anything, is copied by a spread, by Object.assign and by a rest pattern, also after its keys were listed. Each copy takes time in proportion to the names.
const count = 400_000;
function filled(): any {
  return JSON.parse("{" + Array.from({ length: count }, (_, at) => '"k' + at + '":' + at).join(",") + "}");
}

function timed(label: string, run: () => any): any {
  const start = Date.now();
  const copy = run();
  console.log(label + ": " + Object.keys(copy).length + " names, the last holds " + copy["k" + (count - 1)] + (Date.now() - start > 10000 ? " TOO SLOW" : ""));
  return copy;
}

const parsed = filled();
let copy = timed("a spread of what was parsed", () => ({ ...parsed }));
copy = timed("a spread of the copy, whose keys were listed", () => ({ ...copy }));
console.log(Object.getOwnPropertySymbols(copy).length);
copy = timed("a spread after its symbols were listed", () => ({ ...copy }));
copy = timed("a spread with one more name", () => ({ ...copy, more: 1 }));
copy = timed("a spread of two", () => ({ ...copy, ...parsed }));
copy = timed("Object.assign to an empty object", () => Object.assign({}, copy));
copy = timed("Object.assign to itself and another", () => Object.assign(copy, parsed));
copy = timed("a rest pattern", () => {
  const { more, ...rest } = copy;
  return rest;
});
for (const name in copy) {
  if (name === "k7") console.log("walked");
}
copy = timed("a spread after a walk over its names", () => ({ ...copy }));
