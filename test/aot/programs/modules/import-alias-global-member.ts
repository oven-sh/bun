// `import a = N.b` where `N` is a global namespace that is only declared (Intl, Reflect, a `declare namespace`): the object exists at run time.
declare namespace Host { function greet(): string; const level: number; namespace inner { const depth: number; } }
(globalThis as any).Host = { greet() { return "hello"; }, level: 1, inner: { depth: 2 } };
import NumberFormat = Intl.NumberFormat;
import ownKeys = Reflect.ownKeys;
import has = Reflect.has;
import R = Reflect;
import Memory = WebAssembly.Memory;
import greet = Host.greet;
import level = Host.level;
import depth = Host.inner.depth;
(globalThis as any).Host.level = 2;
console.log(new NumberFormat("en-US", { minimumFractionDigits: 2 }).format(1.5), NumberFormat === Intl.NumberFormat, typeof NumberFormat);
console.log(ownKeys({ a: 1, b: 2 }).join(), has({ a: 1 }, "a"), R === Reflect, R.get({ q: 1 }, "q"));
console.log(typeof Memory, Memory === WebAssembly.Memory, new Memory({ initial: 1 }).buffer.byteLength);
console.log(greet(), level, Host.level, depth);
