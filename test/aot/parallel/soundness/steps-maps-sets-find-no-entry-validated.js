// The last step of a loop over a map or a set finds no entry and has no key, value or element. A validating build tests every result of the step where it is defined.
// Flags: --aot-validate
const held = { n: 21 };
const pair = [...new Map([["k", held]])][0];
console.log(pair[0], pair[1].n);

const neverFilled = new Map();
for (const entry of neverFilled) console.log(entry);
console.log("end of the empty map");

for (const element of new Set([held])) console.log(element.n);
for (const [key, value] of new Map([[held, 1.5], [{ n: 22 }, 2.5]])) console.log(key.n, value);
for (const key of new Map([["a", held]]).keys()) console.log(key);
for (const value of new Map([["a", held]]).values()) console.log(value.n);
for (const element of new Set()) console.log(element);
console.log("end of the empty set");
