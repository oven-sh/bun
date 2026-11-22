// Draws for generators whose program number is the random seed.
import { mkdirSync, writeFileSync } from "node:fs";

export class Draws {
  private state: number;
  constructor(seed: number) {
    this.state = (seed * 2654435761 + 12345) >>> 0;
  }
  next = () => {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let hash = Math.imul(this.state ^ (this.state >>> 15), this.state | 1);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
  below = (bound: number) => Math.floor(this.next() * bound);
  between = (least: number, most: number) => least + this.below(most - least + 1);
  chance = (share: number) => this.next() < share;
  pick = <T>(from: readonly T[]): T => from[this.below(from.length)]!;
  several = <T>(count: number, make: (at: number) => T): T[] => Array.from({ length: count }, (_, at) => make(at));
  /** So many of them, each at most once. */
  sample = <T>(from: readonly T[], count: number): T[] => {
    const left = [...from];
    return Array.from({ length: Math.min(count, left.length) }, () => left.splice(this.below(left.length), 1)[0]!);
  };
}

/** The command line of a sweep: <folder> [from] [count] [stride], or `count`. */
export function writePrograms(total: number, write: (seed: number) => { name: string; text: string }) {
  if (process.argv[2] === "count") {
    console.log(total);
    return;
  }
  const [folder, from, count, stride] = [process.argv[2]!, Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${String(index).padStart(7, "0")}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
