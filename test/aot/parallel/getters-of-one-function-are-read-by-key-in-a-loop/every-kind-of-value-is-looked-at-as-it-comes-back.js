"use strict";
const Hidden = globalThis[process.argv.length > 90 ? "Array" : ["Ob", "ject"].join("")];
const never = {};
let runs = 0;
function lazy(name, kind, sentinel) { let last = sentinel, value; return () => { runs++; const raw = process.env[name]; if (raw !== last) { value = kind.parse(raw); last = raw; } return value; }; }
const truth = { parse(raw) { return raw === "1" || raw === "true"; } };
const words = { parse(raw) { return raw; } };
const ground = { ground: true };
function make(kinds) { const made = Object.create(ground); for (const [name, kind] of Object.entries(kinds)) Object.defineProperty(made, name, { get: lazy(name, kind, made), enumerable: true, configurable: true }); return made; }
const ROOMS = make({ ROOM_ALPHA: truth, ROOM_BRAVO: truth, ROOM_CEDAR: truth, ROOM_DELTA: truth, ROOM_EMBER: words, ROOM_FJORD: truth, ROOM_GRAIN: truth, ROOM_HAZEL: truth, ROOM_IVORY: truth, ROOM_JOLLY: words, ROOM_KNOLL: truth, ROOM_LEMON: truth });
const LIST = ["ROOM_BRAVO", "ROOM_CEDAR", "ROOM_DELTA", "ROOM_EMBER", "ROOM_FJORD", "ROOM_GRAIN"];
const seen = [];
function note(value) { const kind = value === null ? "null" : typeof value === "object" ? Object.prototype.toString.call(value) : typeof value === "function" ? "function:" + value.length : typeof value + ":" + String(value); if (!seen.includes(kind)) seen.push(kind); return kind.length; }
function count() { let found = 0; for (let i = 0; i < LIST.length; i++) found += note(ROOMS[LIST[i]]); return found; }
function change() { process.env.ROOM_CEDAR = "1"; ROOMS.text = "a text"; ROOMS.list = [1, 2]; ROOMS.record = { a: 1 }; ROOMS.big = 10n; ROOMS.mark = Symbol.iterator; ROOMS.none = null; ROOMS.half = 0.5; LIST.push("text", "list", "record", "big", "none", "half", "nothing at all"); } function again() { Bun.gc(true); Hidden.defineProperty(ROOMS, "both", { get: () => new Map(), set() {}, configurable: true }); LIST.push("both"); Bun.gc(true); }
const n = 4000; let sum = 0; for (let t = 0; t < n; t++) { if (t === (n >> 1)) change(t); if (t === (n >> 1) + (n >> 2)) again(t); sum = (sum * 3 + count() + 1) % 1000003; }
console.log(sum, runs, seen.join(" "));
