const names = ["./first.cjs", "./second.cjs"];
const named = (key) => names[key % names.length];
import.meta.require(named(0));
await import(named(0));
await import(named(1));
console.log(import.meta.require(named(1)).__esModule, import.meta.require(named(0)).__esModule);
