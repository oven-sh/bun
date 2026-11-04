// parameters written `number` that every call in sight fills with an int32 are handed -0, which comes from outside by a call that nobody follows: 1 / x and Object.is tell it from 0, a Map and a text do not
function inverse(x: number) { return 1 / x; }
function isNegativeZero(x: number) { return Object.is(x, -0); }
function underKey(x: number) { const map = new Map<number, string>([[0, "zero"]]); return String(map.get(x)) + " " + String(map.has(x)); }
function asText(x: number) { return String(x) + " " + `${x}` + " " + JSON.stringify(x); }
function doubled(x: number) { return x * 2; }
function less(x: number) { return x - 0; }
function handedOn(x: number) { return x >= 0 ? x : 0 - x; }
const outside: any[] = JSON.parse("[-0, 0]");
function deed(x: number) { return String(inverse(x)) + " " + String(isNegativeZero(x)) + " " + underKey(x) + " " + asText(x) + " " + String(1 / doubled(x)) + " " + String(1 / less(x)) + " " + String(1 / handedOn(x)); }
const unseen = JSON.parse("{}");
unseen.deed = deed;
console.log(deed(1), deed(0), deed(-3));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed(turn & 3);
console.log(last);
for (let i = 0; i < outside.length; i++) console.log(String(unseen.deed(outside[i])));
console.log(deed(0), deed(2));
