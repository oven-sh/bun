"use strict";
interface Part {
  label: string;
  size: number;
}
interface Gadget {
  name: string;
  parts: Part[];
  owner: Gadget | null;
  weight: number;
  count: number;
  ready: boolean;
  note: string;
  extra: Part;
}
function born(step: number): Gadget {
  return Object.assign({ name: "g" + step }, step % 3 ? { weight: step / 2 } : {}) as unknown as Gadget;
}
function finish(gadget: Gadget, step: number, previous: Gadget | null) {
  switch (step % 5) {
    case 0:
      Object.assign(gadget, { parts: [{ label: "p" + step, size: step }], owner: previous });
      break;
    case 1:
      Object.defineProperty(gadget, "count", { value: step, enumerable: true, writable: true, configurable: true });
      break;
    case 2:
      Object.defineProperties(gadget, {
        ready: { value: step % 2 === 0, enumerable: true, writable: true, configurable: true },
        note: { value: "n" + step, enumerable: true, writable: true, configurable: true },
      });
      break;
    case 3:
      gadget.extra = { label: "x" + step, size: -step };
      gadget.owner = previous;
      break;
  }
}
function describe(gadget: Gadget): string {
  const parts = gadget.parts as Part[] | undefined;
  const owner = gadget.owner as Gadget | null | undefined;
  const extra = gadget.extra as Part | undefined;
  return [
    gadget.name,
    parts ? parts.length + parts[0].label + parts[0].size : "-",
    owner === undefined ? "-" : owner === null ? "null" : owner.name,
    gadget.weight,
    gadget.count,
    gadget.ready,
    gadget.note,
    extra ? extra.label + extra.size : "-",
    Object.keys(gadget).join("."),
  ].join("|");
}
function hash(text: string, seed: number): number {
  let value = seed;
  for (let index = 0; index < text.length; index++) value = (Math.imul(value, 31) + text.charCodeAt(index)) | 0;
  return value;
}
const ringSize = 2048;
const delay = 700;
const ring: (Gadget | undefined)[] = new Array(ringSize).fill(undefined);
let garbage: unknown[] = [];
let sum = 17;
for (let step = 0; step < 40000; step++) {
  ring[step % ringSize] = born(step);
  if (step >= delay) {
    const late = step - delay;
    finish(ring[late % ringSize]!, late, late ? ring[(late - 1) % ringSize]! : null);
  }
  garbage.push({ step, text: "t" + step, list: [step, step + 1] });
  if (garbage.length > 300) garbage = [];
  if (step % 4096 === 4095) Bun.gc(true);
  else if (step % 1024 === 1023) Bun.gc(false);
  if (step % 997 === 0) {
    for (let index = 0; index < ringSize; index += 37) {
      const gadget = ring[index];
      if (gadget) sum = hash(describe(gadget), sum);
    }
  }
}
Bun.gc(true);
for (const gadget of ring) sum = hash(describe(gadget!), sum);
console.log(sum, describe(ring[5]!), describe(ring[6]!), describe(ring[7]!), describe(ring[8]!), describe(ring[9]!));
