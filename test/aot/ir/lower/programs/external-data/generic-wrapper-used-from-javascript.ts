// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// A generic class whose generic methods mention the class applied to their own type parameter, used from an untyped file: the class keeps its layout, and still accepts what untyped code hands it.
import { idOf, make } from "./model.ts";
import { run } from "./use.js";
declare const console: { log(...values: unknown[]): void };
console.log(run().join(" "));
const typed = make(20);
typed.put({ id: 21 });
typed.put(make(22));
console.log(idOf(typed), typed.same(typed.value));

// FILE: model.ts
export type Row = { id: number };
export type Held<T extends object> = Wrapper<T> | (Wrapper<T> & { readonly tag: T });
export class Wrapper<T extends object> {
  constructor(public value: T) {}
  put<Inner extends T>(next: Inner | Held<Inner>): void { this.value = next instanceof Wrapper ? next.value : next; }
  putTwice<Inner extends T>(first: Inner | Held<Inner>, second: Inner | Held<Inner>): void { this.put(first); this.put(second); }
  take<Inner extends T>(from: Held<Inner>): Inner { const taken = from.value; this.value = taken; return taken; }
  wrap<Inner extends T>(next: Inner): Wrapper<Inner> { return new Wrapper<Inner>(next); }
  pick<Inner extends T>(first: Held<Inner>, second: Held<Inner>, useFirst: boolean): Held<Inner> { return useFirst ? first : second; }
  same<Inner extends T>(other: Inner | Held<Inner>): boolean { return (other instanceof Wrapper ? other.value : other) === this.value; }
}
export function make(id: number): Wrapper<Row> { return new Wrapper<Row>({ id }); }
export function idOf(wrapper: Wrapper<Row>): number { return wrapper.value.id; }

// FILE: use.js
import { Wrapper, idOf, make } from "./model.ts";
export function run() {
  const lines = [];
  const wrapper = make(1);
  lines.push(idOf(wrapper));
  wrapper.put({ id: 2, extra: "two" });
  lines.push(idOf(wrapper), wrapper.value.extra);
  wrapper.put(new Wrapper({ id: 3 }));
  lines.push(idOf(wrapper));
  wrapper.putTwice({ id: 4 }, make(5));
  lines.push(idOf(wrapper));
  lines.push(wrapper.take(make(6)).id, idOf(wrapper));
  const inner = wrapper.wrap({ id: 7, more: [1, 2] });
  lines.push(inner.value.id, inner.value.more.length, inner instanceof Wrapper);
  lines.push(idOf(wrapper.pick(make(8), make(9), false)));
  const tagged = Object.assign(make(10), { tag: { id: 11 } });
  lines.push(idOf(wrapper.pick(tagged, make(12), true)), tagged.tag.id);
  lines.push(wrapper.same(wrapper), wrapper.same(wrapper.value), wrapper.same({ id: 6 }));
  return lines;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
