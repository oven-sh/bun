// A loop only stores products into a list that a constant of the file holds; nothing is known of the list. Fractions, whole numbers, holes, texts, views of several kinds, a list with a setter
// under an index above it, a frozen and a sealed list, a list that grows, an object that is no list, and a store that lands behind the end.
"use strict";
// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 12
const make = text => JSON.parse(text), many = at => JSON.parse("[" + Array.from({ length: 40 }, (_, i) => JSON.stringify(at(i))).join() + "]");
const fractions = many(() => 0.5), wholes = many(i => i), mixed = many(i => i % 3 ? i : i % 2 ? "two" : null), holed = many(i => i), short = make("[1]"), record = make('{"0":1,"length":1}');
delete holed[1];
const doubles = new Float64Array(39), bytes = new Uint8Array(40), clamped = new Uint8ClampedArray(40), ints = new Int32Array(40);
const frozen = Object.freeze(many(i => i)), sealed = Object.seal(many(i => i).slice(0, 39));
function intoFractions(s) { for (let i = 0; i < 40; i++) fractions[i] = i * s; }
function intoWholes(s) { for (let i = 0; i < 40; i++) wholes[i] = i * s; }
function intoMixed(s) { for (let i = 0; i < 40; i++) mixed[i] = i * s; }
function intoHoled(s) { for (let i = 0; i < 40; i++) holed[i] = i * s; }
function intoShort(s) { for (let i = 0; i < 40; i += 2) short[i] = i * s; }
function intoRecord(s) { for (let i = 0; i < 40; i++) record[i] = i * s; }
function intoDoubles(s) { for (let i = 0; i < 40; i++) doubles[i] = i * s; }
function intoBytes(s) { for (let i = 0; i < 40; i++) bytes[i] = i * s; }
function intoClamped(s) { for (let i = 0; i < 40; i++) clamped[i] = i * s; }
function intoInts(s) { for (let i = 0; i < 40; i++) ints[i] = i * s; }
function intoFrozen(s) { for (let i = 0; i < 40; i++) frozen[i] = i * s; }
function intoSealed(s) { for (let i = 0; i < 40; i++) sealed[i] = i * s; }
const all = { intoFractions, intoWholes, intoMixed, intoHoled, intoShort, intoRecord, intoDoubles, intoBytes, intoClamped, intoInts, intoFrozen, intoSealed };
const held = { intoFractions: fractions, intoWholes: wholes, intoMixed: mixed, intoHoled: holed, intoShort: short, intoRecord: record, intoDoubles: doubles, intoBytes: bytes, intoClamped: clamped, intoInts: ints, intoFrozen: frozen, intoSealed: sealed };
for (const scale of [0.5, 2, -1.5, 200, NaN, "3", null, { valueOf() { return 4; } }, 2n]) {
  for (const name in all) {
    let said;
    try { all[name](scale); said = "ok"; } catch (error) { said = error.constructor.name; }
    console.log(String(typeof scale === "object" && scale ? "object" : scale), name, said, JSON.stringify(Array.from(held[name], v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : v).filter((_, i) => i < 3 || i > 37)), held[name].length);
  }
}
