// The variable of the walk is declared outside it.
const wanted = { findLastIndex: n => n < 3 };
let name;
let found = -2;
for (name in wanted) found = [1, 2, 3][name]?.(wanted[name]);
console.log(found);
