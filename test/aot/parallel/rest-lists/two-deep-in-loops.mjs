const out = [];
const show = v => typeof v === "string" ? JSON.stringify(v) : typeof v === "function" ? "function" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : v instanceof Error ? v.name + ":" + v.message : v !== null && typeof v === "object" ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" : Object.is(v, -0) ? "-0" : String(v);
const log = (...vs) => out.push(vs.map(show).join(" "));
const list = JSON.parse('[3,1.5,"x",null,-2,true]');
function tag(strings, ...values) { let t = strings[0]; for (let j = 0; j < values.length; j++) t += String(values[j]) + strings[j + 1]; return t; }
function sum(first, ...rest) { let t = first; for (let j = 0; j < rest.length; j++) t += rest[j]; return t; }
function changes(...rest) { rest.push(9); rest[0] = 8; let t = ""; for (let j = 0; j < rest.length; j++) t += rest[j] + ","; return t + rest.length; }
const kept = [];
function keeps(...rest) { for (let j = 0; j < rest.length; j++) if (rest[j] === null) kept.push(rest); return rest; }
function throws(...rest) { for (let j = 0; j < rest.length; j++) if (rest[j] === "x") throw new RangeError("at " + j); return rest.length; }
class Counted { valueOf() { log("valueOf"); return 4; } }
const steps = { one(x, i) { return tag`a${x}b${i}c`; }, two(x, i) { return sum(x, i, 1) + "|" + sum(x); }, three(x, i) { return changes(x, i) + changes(x); }, four(x, i) { return keeps(x, i, x).length + keeps().length; },
  five(x, i) { return throws(i, x, i); }, six(x, i) { return sum(new Counted(), x, i); }, seven(x, i) { return sum(...list, x); }, eight(x, i) { return tag`${tag`${x}`}${sum(i, i)}`; } };
function call(f, x, i) { try { return f(x, i); } catch (error) { return error; } }
for (let round = 0; round < 2; round++)
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    log(steps.one(x, i), steps.two(x, i), steps.three(x, i), steps.four(x, i), steps.seven(x, i), steps.eight(x, i), steps.six(x, i));
    log(call(steps.five, x, i));
  }
// Read by a literal key, with and without what is listed.
const table = { plain(...rest) { return rest.length + ":" + rest[0] + rest[1] + rest[2] + rest[3]; } };
function emit(type, ...args) { const f = table[type]; if (f === undefined) return false; if (args.length > 3) return f.apply(table, args); switch (args.length) { case 0: return f.call(table); case 1: return f.call(table, args[0]); case 2: return f.call(table, args[0], args[1]); default: return f.call(table, args[0], args[1], args[2]); } }
function run() { for (let i = 0; i < list.length; i++) { const x = list[i]; log(emit("plain"), emit("plain", x), emit("plain", x, i), emit("plain", x, i, 1), emit("plain", x, i, 1, 2), emit("none", x), emit("plain", undefined), emit("plain", ...list)); } }
run();
table.none = (...rest) => rest;
run();
log(kept.length, kept);
console.log(out.join("\n"));
