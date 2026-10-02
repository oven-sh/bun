import { readFileSync } from "node:fs";

export type CompiledFunction = {
  index: number;
  offset: number;
  size: number;
  module: number;
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
  functions: CompiledFunction[] = [];
  codeAddress: number;
  codeSizeInBytes = 0;
  #stubs: { offset: number; name: string }[] = [];
  #stubCopies: number[] = [];
  #stubsSize = 0;
  #regExpsStart = Infinity;

  constructor(path: string, codeAddress?: string) {
    this.codeAddress = Number(codeAddress ?? 0);
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [what, ...fields] = line.split("\t");
      if (what === "F") {
        const [index, offset, size, module, start, kind] = fields.map(Number);
        this.functions.push({ index, offset, size, module, start, kind, name: fields[6] ?? "" });
      } else if (what === "T") this.#stubs.push({ offset: +fields[0], name: fields[1] });
      else if (what === "C") this.#stubCopies.push(+fields[0]);
      else if (what === "R") this.#regExpsStart = +fields[0];
      else if (what === "B") this.codeSizeInBytes = +fields[0];
    }
    this.functions.sort((a, b) => a.offset - b.offset);
    this.#stubs.sort((a, b) => a.offset - b.offset);
    this.#stubsSize = this.#stubs.at(-1)?.offset ?? 0;
  }

  at(offset: number): Place {
    for (const copy of this.#stubCopies) {
      if (offset >= copy && offset < copy + this.#stubsSize) {
        const stub = lastAtOrBefore(this.#stubs, offset - copy)!;
        return { in: "stub", name: stub.name, offset: offset - copy - stub.offset };
      }
    }
    if (offset >= this.#regExpsStart && offset < this.codeSizeInBytes) return { in: "regexp" };
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
