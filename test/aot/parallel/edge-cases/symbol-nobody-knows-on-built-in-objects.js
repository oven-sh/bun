// A key that is a symbol nobody knows at build time names no global that is read by its name, and still hits whatever lies under a symbol on a built-in object.
const version = process.versions.bun.length;
const key = Symbol.for(`someNameOfMine.${version}`);
globalThis[key] = { run() { return 42; } };
console.log(globalThis[Symbol.for(`someNameOfMine.${version}`)].run());
console.log(typeof Date.now(), typeof Buffer.from, Math.floor(1.5));
console.log(Object.getOwnPropertySymbols(globalThis).includes(key));
console.log(key in globalThis, delete globalThis[key], key in globalThis, globalThis[key]);

Object.defineProperty(globalThis, Symbol.for(`defined.${version}`), { value: "defined", configurable: true });
console.log(globalThis[Symbol.for(`defined.${version}`)]);

const unknownKey = process.argv.length > 99 ? "Date" : Symbol.for(`defined.${version}`);
console.log(globalThis[unknownKey]);

class Stamp extends Date {}
const conversion = Object.getOwnPropertySymbols(Date.prototype)[0];
console.log(conversion === Symbol.toPrimitive, typeof +new Stamp(0));
Object.defineProperty(Stamp.prototype, conversion, { value() { return 5; }, configurable: true });
console.log(+new Stamp(0), `${new Stamp(0)}`);
const tag = Object.getOwnPropertySymbols(WeakRef.prototype)[0];
console.log(tag === Symbol.toStringTag, String(new WeakRef({})));
Object.defineProperty(WeakRef.prototype, tag, { value: "Renamed", configurable: true });
console.log(String(new WeakRef({})));
