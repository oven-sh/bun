// Generates random programs of classes whose methods are replaced (write-replaced-methods.ts). The program number is the random seed.
//
//   bun write-random-replaced-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<classes>-classes.mjs or .ts
//   bun write-random-replaced-sweep.ts count
import { mkdirSync, writeFileSync } from "fs";
import { writeReplacedMethods } from "./write-replaced-methods.ts";

const total = 8_000_000;

function createRandom(seed: number) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let hash = Math.imul(state ^ (state >>> 15), state | 1);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
}

function write(seed: number): { name: string; text: string } {
  const random = createRandom(seed);
  const isTyped = random() < 0.4;
  const { name, lines } = writeReplacedMethods(random, isTyped);
  return {
    name: name + (isTyped ? ".ts" : ".mjs"),
    text: [...lines, ...(isTyped ? ["export {};"] : [])].join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
