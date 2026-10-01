// Reads the samples of lr-probe.c: a line for each, with pc, lr, x0, x1 and x2 in hexadecimal.
import { readFileSync } from "node:fs";
import type { ImageMap } from "./map.ts";

export type Samples = {
  total: number;
  /** In a compiled function, by offset in the code. */
  own: Map<number, number>;
  /** In a stub that a compiled function called, by the offset that the call returns to, and by stub. */
  inStubs: Map<number, Map<string, number>>;
  inStubsFromElsewhere: number;
  inRegExps: number;
  outside: number;
};

export function readSamples(path: string, map: ImageMap): Samples {
  if (!map.addressOfCode) throw new Error("the map does not say where the code is");
  const samples: Samples = { total: 0, own: new Map(), inStubs: new Map(), inStubsFromElsewhere: 0, inRegExps: 0, outside: 0 };
  const offsetOf = (address: string) => {
    const offset = parseInt(address, 16) - map.addressOfCode;
    return offset >= 0 && offset < map.sizeOfCode ? offset : undefined;
  };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [pc, lr] = line.split(" ");
    if (!lr) continue;
    samples.total++;
    const offset = offsetOf(pc);
    const place = offset === undefined ? undefined : map.at(offset);
    if (!place || place.in === "nothing") samples.outside++;
    else if (place.in === "regexp") samples.inRegExps++;
    else if (place.in === "function") samples.own.set(offset!, (samples.own.get(offset!) ?? 0) + 1);
    else {
      const returnsTo = offsetOf(lr);
      if (returnsTo === undefined || map.at(returnsTo).in !== "function") {
        samples.inStubsFromElsewhere++;
        continue;
      }
      if (!samples.inStubs.has(returnsTo)) samples.inStubs.set(returnsTo, new Map());
      const byStub = samples.inStubs.get(returnsTo)!;
      byStub.set(place.name, (byStub.get(place.name) ?? 0) + 1);
    }
  }
  return samples;
}
