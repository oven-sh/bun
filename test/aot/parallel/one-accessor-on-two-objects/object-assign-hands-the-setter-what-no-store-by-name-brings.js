// Every store by name brings the setter a number. Object.assign brings it a text.
const meter = { raw: 0, get value() { return this.raw; }, set value(next) { this.raw = next; } };
let sum = 0;
for (let i = 0; i < 300; i++) { meter.value = i; sum += meter.value; }
Object.assign(meter, { value: "text" });
console.log(sum, typeof meter.raw, meter.raw + 1, meter.value + 1);
