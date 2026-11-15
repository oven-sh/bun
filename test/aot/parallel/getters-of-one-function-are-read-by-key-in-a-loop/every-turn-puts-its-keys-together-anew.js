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
const head = process.argv.length > 90 ? "HALL_" : "ROOM_";
const TAILS = LIST.map(name => name.slice(5));
process.env.ROOM_CEDAR = "1"; process.env.ROOM_EMBER = "true"; process.env.ROOM_FJORD = "a text";
let turn = 0;
const KEYS = [];
function fresh() { turn++; for (let i = 0; i < TAILS.length; i++) KEYS[i] = head + TAILS[(i + turn) % TAILS.length]; }
function count() { let found = 0; fresh(); for (let i = 0; i < LIST.length; i++) { if (ROOMS[LIST[i]]) found += 100; } for (let i = 0; i < KEYS.length; i++) { if (ROOMS[KEYS[i]]) found += ((i + turn) % TAILS.length) + 1; } return found; }
function change() {} function again() {}
const n = 4000; let sum = 0; for (let t = 0; t < n; t++) { if (t === (n >> 1)) change(t); if (t === (n >> 1) + (n >> 2)) again(t); sum = (sum * 3 + count() + 1) % 1000003; }
console.log(sum, runs);
