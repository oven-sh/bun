"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] !== null ? JSON.stringify(list[i]) : typeof list[i] + ":" + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) if (i in rows) out[i] = take(rows[i], i); return out; };
let wrong = 0;
const hold = (got, rows, take, label) => { const want = show(plainly(rows, take)), said = show(got); if (said !== want) { wrong++; console.log("WRONG", label, said, "FOR", want); } return said; };
const brief = text => { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003; return text.length + "#" + h; };

const out = globalThis.process ? (value => (globalThis.__kept = value, globalThis.__kept)) : (value => value);
function bare(n) { return out(new Array(n)); }
function filledElsewhere(n, fill) { const list = out(new Array(n)); fill(list); return list; }
const fills = [list => { for (let i = 0; i < list.length; i++) list[i] = i; }, list => { for (let i = 0; i < list.length; i++) list[i] = i + 0.5; }, list => { for (let i = 0; i < list.length; i++) list[i] = "t" + i; }, list => { list[1] = 1; }, list => {}, list => { list.push(1); }, list => { list.fill(0); }, list => { list.length = 2; }];
for (const n of [0, 1, 3, 8, 130]) { const said = new Set(); for (let birth = 0; birth < 5; birth++) { const list = bare(n); said.add(show(list) + "|" + (0 in list) + "|" + list.length + "|" + Object.keys(list).length); } console.log("bare", n, said.size, brief([...said].join())); }
fills.forEach((fill, which) => { for (const n of [0, 3, 8]) { const said = new Set(); for (let birth = 0; birth < 70; birth++) said.add(show(filledElsewhere(n, fill))); console.log("filled", which, n, said.size, [...said].join(" / ")); } });
console.log(wrong);
