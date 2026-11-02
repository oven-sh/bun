// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: greet
// CHECK-LABEL: function {{*}}name="greet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="hello"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
