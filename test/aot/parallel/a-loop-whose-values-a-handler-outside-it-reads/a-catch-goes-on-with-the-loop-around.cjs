"use strict";
// STATISTIC: LoopsVersionedUnderOuterHandlers >= 1
// The catch leaves the inner loop for the next turn of the loop around: it lies outside the one and inside the other.
const key = JSON.parse('"go"'), log = [];
const counted = (values, name) => ({ [Symbol.iterator]() { let at = 0; return { next() { return at < values.length ? { done: false, value: values[at++] } : { done: true, value: undefined }; }, return() { log.push("closed " + name + " at " + at); return {}; } }; } });
const throwing = { valueOf() { throw new RangeError("no number"); } };
const p = JSON.parse("[[1,2],[3,4]]");
const T = { go(s, w) { let t = 0; rows: for (let r = 0; r < 3; r++) { for (let i = 0; i < s.length; i++) { const v = s[i] * 2 + r; try { t += v * w[i]; } catch (e) { t -= v; continue rows; } } t += 100; } return t; } };
const holders = () => [JSON.parse("[1.5,2.25,3,4.5]"), JSON.parse("[1,2,3,4]"), [1.5, 2n, 3], [1, 2, 3n], [1, throwing, 3], [1, , 3], [], ["2", "x"], new Uint8Array([1, 2, 30]), Buffer.from([4, 5, 6]), new Float64Array([0.5, 1.5, 30.5]), new BigInt64Array([1n, 2n]), "123"];
const others = () => [...holders(), counted([1, 2], "numbers"), counted([1, 2n, 3], "mixed"), counted([1, 5, 2], "large"), new Set([1, 2n])];
const show = v => typeof v === "function" ? "f " + v() : Array.isArray(v) ? "[" + v.map(String).join() + "]" : String(v);
const turns = +process.argv[2] || 2;
for (const s of holders()) for (const w of others()) for (let turn = 0; turn < turns; turn++) { let said; try { said = show(T[key](s, w)); } catch (e) { said = "out: " + e.name + " " + e.message.slice(0, 24); } console.log(said, log.splice(0).join(" . ")); }
