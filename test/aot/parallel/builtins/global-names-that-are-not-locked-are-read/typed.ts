// The same with types written.
let reads: number = 0;
let made: number = 0;
const realDate: DateConstructor = globalThis.Date;
Object.defineProperty(globalThis, "Date", { configurable: true, get(): DateConstructor { reads++; return realDate; } });
(globalThis as any).WeakMap = class { constructor() { made++; } };
const taken: DateConstructor = Date;
const cast = Date as unknown;
const map: WeakMap<object, number> = new WeakMap<object, number>();
console.log(reads + " " + made);
