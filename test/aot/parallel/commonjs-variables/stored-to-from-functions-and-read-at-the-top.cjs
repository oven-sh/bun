let mode = "start";
var legacy;
const log = [];
function set(next) { const old = mode; mode = next; legacy = old; return old; }
const api = { set, get mode() { return mode; }, reset() { mode = "start"; } };
log.push(set("one"), mode, legacy, api.mode);
api.reset();
log.push(mode, typeof undeclared, (() => { try { mode = missing; } catch (e) { return e.name; } })(), mode);
console.log(log.join());
