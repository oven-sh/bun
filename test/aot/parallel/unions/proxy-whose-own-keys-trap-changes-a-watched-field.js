// `for (const k in options)` lists keys. On a proxy the ownKeys trap runs, and it stores into a field that the caller has read in front of the loop and reads again behind it
// Under: --aot-testing=CheckProofsAtRunTime: LinkedFunction::effectsOnReturn of count(): no code runs where the keys of an object of the program are listed
class Options { constructor() { this.depth = 1; this.width = 2; } }
const watched = { hits: 0 };
function count(options) { let n = 0; for (const k in options) n++; return n; }
function deed(options) {
    const before = watched.hits;
    const n = count(options);
    return String(n) + " " + String(watched.hits - before);
}
console.log(deed(new Options()));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(new Options());
console.log(log);
const proxy = new Proxy({ a: 1 }, { ownKeys(target) { watched.hits += 5; return Reflect.ownKeys(target); } });
const made = [proxy, new Options()];
const outside = JSON.parse("[0, 1, 0]");
for (let i = 0; i < outside.length; i++) console.log(deed(made[outside[i]]));
console.log(String(watched.hits));
