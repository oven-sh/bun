// Literals whose members are computed, beside constant literals of the same names. What the literals hold is asked in several ways.
function writeBoth(given) {
  return JSON.stringify({ a: given.x, b: [given.x, 1] });
}
console.log(writeBoth({ y: 1 }));
console.log(JSON.stringify({ a: undefined, b: 2 }));

function listKeys(given) {
  return Object.keys({ c: given.x, d: [given.x, 1] });
}
console.log(listKeys({ y: 1 }));
console.log(Object.keys({ c: undefined, d: 2 }));

function writeBehindSpread(given) {
  return JSON.stringify({ ...given, e: given.x, f: [given.x, 1] });
}
console.log(writeBehindSpread({ y: 1 }));
console.log(JSON.stringify({ y: 1, e: undefined, f: 2 }));

function listEntriesOfThree(given) {
  return Object.entries({ g: given.x, h: [given.x, 1], i: String(given.y) });
}
console.log(listEntriesOfThree({ y: 1 }));
console.log(Object.entries({ g: undefined, h: 2, i: "" }));
