import { test } from "bun:test";
import { randomBytes } from "node:crypto";
import { total, turns, loud } from "./product.ts";
// A loop of the product goes over what is written as Uint8Array and is handed a view made by Uint8Array and a Buffer, each out of a call of the host, so that the written type is all that the loop knows. `length` is a getter found above both. A test replaces it on each object above them,
// by five deeds, between calls at one site and in the middle of a loud turn, and puts it back. What is written above a class is remembered for the rest of the run, so only the first holder meets the
// loop as it was compiled: each of the three comes first in a folder of its own.
test("each is heard", () => {
  const define = Reflect.defineProperty, said: string[] = [];
  const views = [() => new TextEncoder().encode("abc").fill(2), () => randomBytes(4).fill(5)];
  const ask = () => views.map(make => { try { return total(make()) + "/" + turns(make()); } catch (e) { return (e as Error).constructor.name; } }).join(",");
  const attempt = (deed: () => void) => { try { deed(); } catch {} };
  const holders: [string, object][] = [["views", Object.getPrototypeOf(Uint8Array.prototype)], ["bytes", Uint8Array.prototype], ["buffer", Buffer.prototype]];
  for (const [name, holder] of holders) {
    const real = Object.getOwnPropertyDescriptor(holder, "length");
    const back = () => { if (real) define(holder, "length", real); else delete (holder as any).length; };
    const deeds: [string, () => void][] = [
      ["store", () => { (holder as any).length = 1; }],
      ["define", () => { define(holder, "length", { value: 1, configurable: true, writable: true }); }],
      ["reflect", () => { Reflect.set(holder, "length", 1); }],
      ["getter", () => { define(holder, "length", { get: () => 2, configurable: true }); }],
      ["delete", () => { delete (holder as any).length; }],
    ];
    for (const [deed, act] of deeds) {
      const row = [name, deed, ask(), ask()];
      attempt(act);
      const between = ask();
      back();
      row.push(between, ask());
      for (const make of views) { let sum: number | string; try { sum = loud(make(), at => { if (at === 1) attempt(act); }); } catch (e) { sum = (e as Error).constructor.name; } back(); row.push(String(sum)); }
      row.push(ask());
      said.push(row.join(" "));
    }
  }
  console.log("SAID " + said.join(" | "));
});
