// Reflect.defineProperty and Object.defineProperty under constant names, on an instance, on a prototype object and on a literal.
function Gauge() { this.level = 2; }
console.log(Reflect.defineProperty(Gauge.prototype, "doubled", { get() { return this.level * 2; } }));
console.log(Reflect.defineProperty(Gauge.prototype, "label", { value: "gauge" }));
const gauge = new Gauge();
Object.defineProperty(gauge, "own", { value: 7, writable: false });
console.log(Reflect.set(gauge, "own", 8));
gauge.level = 4;
console.log(gauge.doubled, gauge.label, gauge.own, Object.keys(gauge).join());
const record = { kept: 1 };
Object.defineProperty(record, "kept", { get() { return "by the getter"; } });
console.log(record.kept, Reflect.defineProperty(Object.freeze({}), "x", { value: 1 }));
