// The array that a loop pushes onto is replaced by another in some of its iterations: the new ones take no room for all that is left.
const object = { a: 1 };
function heap() { Bun.gc(true); return process.memoryUsage().heapUsed; }
class Flushed { constructor() { this.buffer = []; this.done = []; } flush() { this.done.push(this.buffer); this.buffer = []; } fill(n, size) { for (let i = 0; i < n; i++) { this.buffer.push(object); if (this.buffer.length === size) this.flush(); } return this.done; } }
class Written { constructor() { this.buffer = []; this.done = []; } fill(n, size) { for (let i = 0; i < n; i++) { this.buffer.push(object); if (this.buffer.length === size) { this.done.push(this.buffer); this.buffer = []; } } return this.done; } }
let current = [];
let done = [];
function next() { done.push(current); current = []; }
function variable(n, size) { done = []; for (let i = 0; i < n; i++) { current.push(object); if (current.length === size) next(); } return done; }
function local(n, size) { const all = []; let chunk = []; for (let i = 0; i < n; i++) { chunk.push(object); if (chunk.length === size) { all.push(chunk); chunk = []; } } return all; }
const kept = [], said = [];
for (const [name, build] of [["flushed", (n, s) => new Flushed().fill(n, s)], ["written", (n, s) => new Written().fill(n, s)], ["variable", variable], ["local", local]]) {
    for (const size of [4, 20, 1000]) {
        const before = heap();
        kept.push(build(size * 200, size));
        const bytes = (heap() - before) / 200 / size;
        if (process.env.SHOW) console.log(name, size, bytes.toFixed(1));
        said.push(name + size + (bytes < 20 + 120 / size ? " small" : " large"));
    }
}
let total = 0;
for (const arrays of kept) for (const array of arrays) total += array.length;
console.log(said.join(", "), total);
