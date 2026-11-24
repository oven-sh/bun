const seed = Number(process.argv[2] ?? 3);
let hits = 0;
const state = { last: "none" };
const map = { first: { enumerable: true, get() { hits++; state.last = "first"; return seed; } }, second: { enumerable: true, get() { hits += 10; state.last = [hits]; return "two"; } } };
const target = {};
Object.defineProperties(target, map);
const text = JSON.stringify(target);
console.log(text, hits, typeof state.last, String(state.last));
