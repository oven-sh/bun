// A member of an object literal under a well-known symbol: the descriptor of the method.
// STATISTIC: IteratorMethodsCalledDirectly >= 1
function make(k: number): any { return { [Symbol.iterator]() { let i = 0; return { next() { return i < k ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const d = Object.getOwnPropertyDescriptor(make(1), Symbol.iterator)!; console.log(typeof d.value, d.writable, d.enumerable, d.configurable, d.value.name, Symbol.iterator in make(1), Object.hasOwn(make(1), Symbol.iterator), make(1).propertyIsEnumerable(Symbol.iterator));
