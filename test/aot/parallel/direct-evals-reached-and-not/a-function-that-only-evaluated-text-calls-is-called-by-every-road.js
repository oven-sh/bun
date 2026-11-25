// No compiled code calls `hidden`, `deeper` or `Made`. The scope of the one eval that runs shows them.
let calls = 0;
function hidden(how) { calls++; return "hidden, " + how; }
function deeper(text) { calls++; const own = "deeper's own"; return eval(text); }
class Made { constructor(how) { calls++; this.how = how; } tell() { return "made, " + this.how; } }
function run(text) { return eval(text); }
console.log(run("hidden('by its name')"));
const closure = run("how => hidden(how)");
console.log(closure("by a closure that the text has made"));
console.log(run("[hidden][0]('out of a list')"), run("hidden.call(null, 'through call')"));
console.log(run("new Made('by new').tell()"), run("Reflect.construct(Made, ['by Reflect']).tell()"));
console.log(run("deeper('own + \", \" + hidden(\"out of a second text\")')"));
const kept = run("({ hidden, deeper })");
console.log(kept.hidden("handed out in an object"), kept.deeper("typeof run"));
setTimeout(() => console.log(run("hidden('later')"), closure("the closure, later"), calls), 0);
Promise.resolve("hidden('behind a promise')").then(run).then(console.log);
