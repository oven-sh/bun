"use strict";
const out = [];
const held = { value: undefined, enumerable: false };
function lay(target, v) { held.value = v; Object.defineProperty(target, "mark", held); held.value = undefined; }
function Maker(v) { lay(this, v); this.last = v; }
const make = (v) => new Maker(v);
const attempt = (deed) => { try { return String(deed()); } catch (e) { return e.constructor.name; } };
const look = (o) => [Object.keys(o).join(), JSON.stringify(o), Object.getOwnPropertyNames(o).join(), JSON.stringify(Object.getOwnPropertyDescriptor(o, "mark"), (k, v) => (typeof v === "function" ? "function" : v)), Object.keys({ ...o }).join(), String("mark" in o), String(Object.hasOwn(o, "mark"))].join(" | ");
function sumOf(list) { let sum = 0; for (const it of list) sum += it.mark === undefined ? 1000 : it.mark; return sum; }
const list = []; for (let i = 0; i < 120; i++) list.push(make(i));
out.push(String(sumOf(list)), look(list[0]), look(list[1]), look(list[119]), look(make(-5)));
const one = list[7];
out.push(attempt(() => (one.mark = "new")), String(one.mark), look(one), attempt(() => delete one.mark), look(one), attempt(() => { one.mark = "back"; return one.mark; }), look(one));
const two = list[8]; out.push(attempt(() => Object.defineProperty(two, "mark", { value: "defined" }).mark), look(two));
const names = []; for (const k in list[9]) names.push(k); out.push(names.join());
const stranger = { own: 1 }; lay(stranger, 5); out.push(look(stranger));
out.push(attempt(() => lay(Object.freeze({}), 1)), String(sumOf(list)));
console.log(out.join("\n"));
