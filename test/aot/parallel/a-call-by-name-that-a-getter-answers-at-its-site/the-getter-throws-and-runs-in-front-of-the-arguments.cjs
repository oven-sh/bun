"use strict";
const key = JSON.parse('"risky"');
const said = [];
const say = (word, value) => { if (said.length < 24) said.push(word); return value; };
let asked = 0;
const table = Object.defineProperty({}, key, { get() { say("get"); if (++asked % 500 === 0) throw new RangeError("asked " + asked); return (a, b) => (a + b) | 0; }, configurable: true });
const parsed = Object.defineProperty(JSON.parse("{}"), key, Object.getOwnPropertyDescriptor(table, key));
function inner(i) { return table.risky(say("first", i), say("second", 1)); }
function plain(i, one) { return table.risky(i, one) + parsed.risky(one, i); }
function drive(turns) {
  let s = 0, caught = 0, last = "";
  for (let i = 0; i < turns; i++) {
    try { s = (s + inner(i)) | 0; } catch (error) { caught++; last = error.name + " " + error.message + " " + /inner/.test(error.stack); } finally { s = (s + 1) | 0; }
    try { s = (s + plain(i, 1)) | 0; } catch (error) { caught++; last = error.name + " " + error.message + " " + /plain/.test(error.stack); } finally { s = (s + 2) | 0; }
  }
  return [s, caught, last, said.join(" ")].join("\n");
}
console.log(drive(+(process.argv[2] ?? 4000)));
