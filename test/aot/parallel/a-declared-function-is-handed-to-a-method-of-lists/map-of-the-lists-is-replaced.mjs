const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

function twice(x) { return x * 2; }
function run(list) { return list.map(twice); }
console.log(say(run([1, 2])));
const own = [3, 4]; own.map = function (f) { return "own " + f(this[0]); };
console.log(say(run(own)), say(run([5])));
const other = Object.setPrototypeOf([6, 7], { map(f) { return "prototype " + f(1); } });
console.log(say(run(other)));
