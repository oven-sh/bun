// What a member under a symbol is named, asked by every road. A type may say another symbol than the one that comes: the name follows the value.
import { far, bare } from "./keys.ts";
const near: unique symbol = Symbol("near");
const shared = Symbol.for("shared");
const empty: unique symbol = Symbol("");
const other = Symbol("other");
const viewed = Symbol("viewed");
const claimed: typeof near = other as any;
const picked: typeof near = (JSON.parse("1") ? Symbol("picked at run time") : near) as any;
class Named { // @ts-expect-error
  [near]() { return 1; }
  [far]() { return 2; }
  [bare]() { return 3; }
  [shared]() { return 4; }
  [empty]() { return 5; } // @ts-expect-error
  [claimed]() { return 6; } // @ts-expect-error
  [picked]() { return 7; }
  get [viewed]() { return 8; }
  static [near]() { return 9; }
  static get [far]() { return 10; }
  static set [far](value: number) {}
  async [Symbol.for("later")]() { return 11; }
}
function describe(holder: object): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const lines: string[] = [];
  for (const key of Reflect.ownKeys(holder)) {
    const found = Object.getOwnPropertyDescriptor(holder, key)!;
    for (const half of [found.value, found.get, found.set]) {
      if (typeof half !== "function" || half === Named) continue;
      const name = Object.getOwnPropertyDescriptor(half, "name")!;
      lines.push([JSON.stringify(half.name), name.writable, name.enumerable, name.configurable, Reflect.ownKeys(half).join("+"), Object.hasOwn(half, "name")].join(" "));
    }
  }
  return lines.join("\n") + work;
}
console.log(describe(Named.prototype));
console.log(describe(Named));
const method = (Named.prototype as any)[near];
let calls = 0;
for (let i = 0; i < 300; i++) calls += method.call(new Named()) + (new Named() as any)[claimed]();
console.log(calls, delete method.name, JSON.stringify(method.name), Reflect.ownKeys(method).join("+"));
Object.defineProperty((Named.prototype as any)[far], "name", { value: "renamed" });
(Named.prototype as any)[bare].extra = 1;
console.log((Named.prototype as any)[far].name, Reflect.ownKeys((Named.prototype as any)[bare]).join("+"), String((Named.prototype as any)[shared]).slice(0, 12));
function twice() { return class { [near]() { return 0; } }; }
const [first, second] = [twice(), twice()];
console.log((first.prototype as any)[near].name, (first.prototype as any)[near] === (second.prototype as any)[near]);
