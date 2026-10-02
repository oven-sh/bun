import { readFileSync } from "node:fs";
import type { ImageMap } from "./map.ts";

export type Samples = {
  total: number;
  own: Map<number, number>;
  inStubs: Map<number, Map<string, number>>;
  isInExternalStubs: number;
  inRegExps: number;
  outside: number;
};

export function readSamples(path: string, map: ImageMap): Samples {
  if (!map.codeAddress)
    throw new Error("--code-at <address>: where the process had the code (BUN_AOT_VERBOSE=1 prints it)");
  const samples: Samples = {
    total: 0,
    own: new Map(),
    inStubs: new Map(),
    isInExternalStubs: 0,
    inRegExps: 0,
    outside: 0,
  };
  const offsetOf = (address: string) => {
    const offset = parseInt(address, 16) - map.codeAddress;
    return offset >= 0 && offset < map.codeSizeInBytes ? offset : undefined;
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
        samples.isInExternalStubs++;
        continue;
      }
      if (!samples.inStubs.has(returnsTo)) samples.inStubs.set(returnsTo, new Map());
      const byStub = samples.inStubs.get(returnsTo)!;
      byStub.set(place.name, (byStub.get(place.name) ?? 0) + 1);
    }
  }
  return samples;
}
