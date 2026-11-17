// A loop sums into variables of its file and of a function around it, and into fields, until an element is null: what it summed before the throw stays.
let total = 0;
let half = 0.5;
let both = 0;
class Counts { weight = 0.5; #hidden = 0; get hidden() { return this.#hidden; } bump() { this.#hidden += 2; } }
const counts = new Counts();
const make = (length, at) => Array.from({ length }, (_, i) => i === at ? null : { depth: i, twice: i * 2 });
const makeAbsent = (length, at) => Array.from({ length }, (_, i) => i === at ? undefined : { depth: i, half: i / 2 });
function fileVariable(list) { let sum = 0, dot = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; sum += p.twice; dot -= p.depth; total += 2; } return [sum, dot]; }
function fileNumber(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; sum += p.half; half += 0.25; } return sum; }
function caughtInside(list) { let sum = 0; try { for (let i = 0; i < list.length; i++) { const p = list[i]; sum += p.twice; both += 2; } } catch (error) { console.log("caught", error.constructor.name, sum, both); } return sum; }
function field(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; sum += p.twice; counts.weight += 0.5; } return sum; }
function privateField(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; sum += p.twice; counts.bump(); } return sum; }
function counters() {
    let count = 0;
    return { add(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; sum += p.depth; count += 2; } return sum; }, see: () => count };
}
const made = counters();
function around(list) { try { return fileVariable(list); } finally { console.log("around", total); } }
for (const [length, at] of [[3, -1], [9, 4], [9, 0], [20, 13], [40, 37], [1, 0], [70, 64]]) {
    try { console.log(String(fileVariable(make(length, at)))); } catch (error) { console.log(error.constructor.name); }
    console.log(total);
    try { console.log(fileNumber(makeAbsent(length, at))); } catch (error) { console.log(error.constructor.name); }
    console.log(half);
    console.log(caughtInside(make(length, at)), both);
    try { console.log(field(make(length, at))); } catch (error) { console.log(error.constructor.name); }
    console.log(counts.weight);
    try { console.log(privateField(make(length, at))); } catch (error) { console.log(error.constructor.name); }
    console.log(counts.hidden);
    try { console.log(made.add(make(length, at))); } catch (error) { console.log(error.constructor.name); }
    console.log(made.see());
    try { console.log(String(around(make(length, at)))); } catch (error) { console.log(error.constructor.name); }
}
