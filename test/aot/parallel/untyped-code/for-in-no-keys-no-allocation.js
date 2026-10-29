// A `for..in` loop that finds no key allocates nothing. The collector is off, so every array ever made is still counted.
// Env: BUN_JSC_useGC=0
import { heapStats } from "bun:jsc";
function Trait() {}
class Kind {}
const targets = [Trait.prototype, Kind.prototype, {}, Object.create(null), new Kind(), null, undefined];
function turns(value) { let n = 0; for (const key in value) n++; return n; }
const arrays = () => heapStats().objectTypeCounts.Array ?? 0;
for (const target of targets) turns(target);
const before = arrays();
let sum = 0;
for (let i = 0; i < 70000; i++) sum += turns(targets[i % targets.length]);
const made = arrays() - before;
console.log("turns", sum, made < 1000 ? "and no list was made" : "and lists were made: " + made);
