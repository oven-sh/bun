// The map of an image, which says what is where in its code. A build writes one when it is asked to:
//
//   BUN_AOT_OPTIONS=aotMapFilePath=<path> bun build --compile --compile-aot ...
//
// AOT::ImageBuilder::finish() says what the lines are.
import { readFileSync } from "node:fs";

export type CompiledFunction = {
  index: number;
  offset: number;
  size: number;
  module: number;
  /** Where it starts in the module's text. */
  start: number;
  kind: number;
  name: string;
};

export type Place =
  | { in: "function"; function: CompiledFunction; offset: number }
  | { in: "stub"; name: string; offset: number }
  | { in: "regexp" }
  | { in: "nothing" };

export const hex = (value: number) => "0x" + value.toString(16);

function lastAtOrBefore<T extends { offset: number }>(sorted: T[], offset: number): T | undefined {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle].offset <= offset) low = middle + 1;
    else high = middle;
  }
  return sorted[low - 1];
}

export class ImageMap {
  /** By offset. */
  functions: CompiledFunction[] = [];
  /** Where the code is mapped in the process that the addresses are from. It differs from run to run: `BUN_AOT_VERBOSE=1` prints it. */
  addressOfCode: number;
  sizeOfCode = 0;
  #stubs: { offset: number; name: string }[] = [];
  #copiesOfStubs: number[] = [];
  #sizeOfStubs = 0;
  #startOfRegExps = Infinity;

  constructor(path: string, addressOfCode?: string) {
    this.addressOfCode = Number(addressOfCode ?? 0);
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [what, ...fields] = line.split("\t");
      if (what === "F") {
        const [index, offset, size, module, start, kind] = fields.map(Number);
        this.functions.push({ index, offset, size, module, start, kind, name: fields[6] ?? "" });
      } else if (what === "T") this.#stubs.push({ offset: +fields[0], name: fields[1] });
      else if (what === "C") this.#copiesOfStubs.push(+fields[0]);
      else if (what === "R") this.#startOfRegExps = +fields[0];
      else if (what === "B") this.sizeOfCode = +fields[0];
    }
    this.functions.sort((a, b) => a.offset - b.offset);
    this.#stubs.sort((a, b) => a.offset - b.offset);
    this.#sizeOfStubs = this.#stubs.at(-1)?.offset ?? 0;
  }

  /** What is at an offset in the code. */
  at(offset: number): Place {
    for (const copy of this.#copiesOfStubs) {
      if (offset >= copy && offset < copy + this.#sizeOfStubs) {
        const stub = lastAtOrBefore(this.#stubs, offset - copy)!;
        return { in: "stub", name: stub.name, offset: offset - copy - stub.offset };
      }
    }
    if (offset >= this.#startOfRegExps && offset < this.sizeOfCode) return { in: "regexp" };
    const found = lastAtOrBefore(this.functions, offset);
    if (found && offset < found.offset + found.size)
      return { in: "function", function: found, offset: offset - found.offset };
    return { in: "nothing" };
  }

  describe(offset: number): string {
    const place = this.at(offset);
    const plus = (within: number) => (within ? ` + ${hex(within)}` : "");
    if (place.in === "function") return nameOf(place.function) + plus(place.offset);
    if (place.in === "stub") return `stub ${place.name}` + plus(place.offset);
    return place.in === "regexp" ? "a regular expression" : "nothing that the map knows";
  }
}

export function nameOf({ index, module, start, name }: CompiledFunction) {
  const where = start === 0xffffffff ? `top-level code of module ${module}` : `module ${module} at ${start}`;
  return `${name || "(anonymous)"} (function ${index}, ${where})`;
}
