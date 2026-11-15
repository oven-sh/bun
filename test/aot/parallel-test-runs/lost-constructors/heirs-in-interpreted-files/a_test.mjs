import { test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { A, C, list, show } from "./kinds.mjs";
test("t", async () => {
  const folder = join(import.meta.dir, "written");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "heirs.mjs"), `import { A, B, C, D, list } from "../kinds.mjs";
export const heirs = list.map((K, i) => class Heir extends K { constructor(t) { super(t, "i" + i); this.heir = i; this.a0 = this.a0 ?? "none"; } who() { return "interpreted " + super.who(); } });
export const made = heirs.map(H => new H(2)).concat(list.map((K, i) => Reflect.construct(K, [i, "r"], list[(i + 1) % list.length])), [new A(1, "a"), new B(2), new C(3), new D(4)]);`);
  const { heirs, made } = await import(join(folder, "heirs.mjs"));
  const said = made.map(show);
  for (const H of heirs) said.push(show(new H(9)));
  for (const K of list) said.push(show(new K(5, "own")), show(Reflect.construct(A, [6, "x"], K)));
  said.push(show(new C(8)));
  console.log("SAID", said.join(" | "));
});
