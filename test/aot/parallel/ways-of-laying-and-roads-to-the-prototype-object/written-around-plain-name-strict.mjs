"use strict";
const log = [];
function User(v) { this.id = 7; this.name = v; this.tail = "t"; }
function build(v) { let made; return new User(v); }
function show(u) { return [u.id + 1, u.name, u.tail, Object.keys(u).join("+"), Object.hasOwn(u, "id"), Object.hasOwn(u, "name"), "name" in u].join(" "); }
function tell(run) { try { return run(); } catch (error) { return error.constructor.name; } }
const early = build(JSON.parse('"ada"')), before = show(early);
Object.defineProperty(early.constructor.prototype, "name", { get() { log.push("get " + this.tail); return "got"; }, set(v) { log.push("set " + v + " " + this.tail); } });
const late = tell(() => show(build(JSON.parse('"bob"')))), base = tell(() => show(new User(JSON.parse('"cyd"'))));
const stored = tell(() => { early.name = "again"; early.id = 9; return show(early); });
console.log(`SAID ${before} | ${late} | ${base} | ${stored} | ${log.join()}`);
