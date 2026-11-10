"use strict";
const never = {};
let runs = 0;
function lazy(name, kind, sentinel) { let last = sentinel, value; return () => { runs++; const raw = process.env[name]; if (raw !== last) { value = kind.parse(raw); last = raw; } return value; }; }
const truth = { parse(raw) { return raw === "1" || raw === "true"; } };
const words = { parse(raw) { return raw; } };
const ground = { ground: true };
function make(kinds) { const made = Object.create(ground); for (const [name, kind] of Object.entries(kinds)) Object.defineProperty(made, name, { get: lazy(name, kind, made), enumerable: true, configurable: true }); return made; }
const ROOMS = make({ ROOM_ALPHA: truth, ROOM_BRAVO: truth, ROOM_CEDAR: truth, ROOM_DELTA: truth, ROOM_EMBER: words, ROOM_FJORD: truth, ROOM_GRAIN: truth, ROOM_HAZEL: truth, ROOM_IVORY: truth, ROOM_JOLLY: words, ROOM_KNOLL: truth, ROOM_LEMON: truth });
const LIST = ["ROOM_BRAVO", "ROOM_CEDAR", "ROOM_DELTA", "ROOM_EMBER", "ROOM_FJORD", "ROOM_GRAIN"];
function count() { let found = 0; LIST.some(name => { if (ROOMS[name]) found++; return false; }); return found; }
function change() { process.env.ROOM_IVORY = "true"; LIST.push("ROOM_IVORY", "ROOM_NOWHERE", 3, Symbol.iterator, { toString() { runs += 100; return "ROOM_IVORY"; } }); } function again() { LIST.length = 2; LIST.unshift("ROOM_JOLLY"); }
const n = 4000; let sum = 0; for (let t = 0; t < n; t++) { if (t === (n >> 1)) change(t); if (t === (n >> 1) + (n >> 2)) again(t); sum = (sum * 3 + count() + 1) % 1000003; }
console.log(sum, runs);
