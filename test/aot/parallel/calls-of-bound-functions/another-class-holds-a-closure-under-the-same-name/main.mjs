import { Other } from "./other.mjs";
class Counter { constructor() { this.total = 0; this.add = this.addImpl.bind(this); } addImpl(v) { this.total = (this.total + v) | 0; } }
function run(counter, n) { for (let i = 0; i < n; i++) counter.add(i); return counter.total; }
console.log(run(new Counter(), JSON.parse("3000000")), new Other().add(1));
