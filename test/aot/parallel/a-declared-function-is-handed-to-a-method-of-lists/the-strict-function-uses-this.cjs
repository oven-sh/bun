"use strict";
const rows = JSON.parse(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: i, qty: 1 + (i % 4), name: "item" + i }))));
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };
function strict(row) { return typeof this + ":" + (this === undefined) + ":" + (this && this.scale ? row.qty * this.scale : row.qty); }
function run(list, given) { return [list.map(strict), list.map(strict, given), list.map(strict, 5), list.filter(strict, given).length, list.some(strict, null)]; }
console.log(say(run(rows.slice(0, 3), { scale: 10 })));
