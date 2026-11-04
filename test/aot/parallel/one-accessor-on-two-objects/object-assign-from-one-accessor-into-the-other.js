// Object.assign reads the getter of one literal and stores into the setter of the other: both run, each with its own object.
const source = { raw: "text", reads: 0, get value() { this.reads++; return this.raw; } };
const target = { low: 0, writes: 0, set value(next) { this.writes++; this.low = next; }, get value() { return this.low; } };
let sum = 0;
for (let i = 0; i < 300; i++) { target.value = i; sum += target.value; }
Object.assign(target, source);
console.log(sum, typeof target.low, target.low, target.writes, source.reads, typeof target.raw, target.reads);
