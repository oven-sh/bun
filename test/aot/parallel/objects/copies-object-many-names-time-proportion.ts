// An object with 400,000 names, of which no type says anything, is copied by a spread, by Object.assign and by a rest pattern, also after its keys were listed. Each copy takes time in proportion to the names: where a copy looks for each name among all the names before it, it takes half a minute and this program minutes.
const count = 400_000;
function filled(): any {
  return JSON.parse("{" + Array.from({ length: count }, (_, at) => '"k' + at + '":' + at).join(",") + "}");
}

function copied(label: string, run: () => any): any {
  const copy = run();
  console.log(label + ": " + Object.keys(copy).length + " names, the last holds " + copy["k" + (count - 1)]);
  return copy;
}

const parsed = filled();
let copy = copied("a spread of what was parsed", () => ({ ...parsed }));
copy = copied("a spread of the copy, whose keys were listed", () => ({ ...copy }));
for (let turn = 0; turn < 5; turn++) copy = copied("once more", () => ({ ...copy }));
console.log(Object.getOwnPropertySymbols(copy).length);
copy = copied("a spread after its symbols were listed", () => ({ ...copy }));
copy = copied("a spread with one more name", () => ({ ...copy, more: 1 }));
copy = copied("a spread of two", () => ({ ...copy, ...parsed }));
copy = copied("Object.assign to an empty object", () => Object.assign({}, copy));
copy = copied("Object.assign to itself and another", () => Object.assign(copy, parsed));
copy = copied("a rest pattern", () => {
  const { more, ...rest } = copy;
  return rest;
});
for (const name in copy) {
  if (name === "k7") console.log("walked");
}
copy = copied("a spread after a walk over its names", () => ({ ...copy }));
/* Output:
a spread of what was parsed: 400000 names, the last holds 399999
a spread of the copy, whose keys were listed: 400000 names, the last holds 399999
once more: 400000 names, the last holds 399999
once more: 400000 names, the last holds 399999
once more: 400000 names, the last holds 399999
once more: 400000 names, the last holds 399999
once more: 400000 names, the last holds 399999
0
a spread after its symbols were listed: 400000 names, the last holds 399999
a spread with one more name: 400001 names, the last holds 399999
a spread of two: 400001 names, the last holds 399999
Object.assign to an empty object: 400001 names, the last holds 399999
Object.assign to itself and another: 400001 names, the last holds 399999
a rest pattern: 400000 names, the last holds 399999
walked
a spread after a walk over its names: 400000 names, the last holds 399999
*/
