// new Uint8Array(n), new Int16Array(n) and new Float64Array(n) for a number n. Compiled code allocates the small ones itself and calls the runtime for the rest. Every element starts at zero, also in memory that held another array, and no array overlaps another.
import { edenGC } from "bun:jsc";

type View = Uint8Array | Int16Array | Float64Array;
type Create = (length: number) => View;

const createBytes = (length: number): Uint8Array => new Uint8Array(length);
const createShorts = (length: number): Int16Array => new Int16Array(length);
const createDoubles = (length: number): Float64Array => new Float64Array(length);

function countOtherElements(view: View, expected: number): number {
  let count = 0;
  for (let i = 0; i < view.length; i++) if (view[i] !== expected) count++;
  return count;
}

// Each array is filled before it dies, so an array that is not cleared shows what its memory held before.
function check(name: string, create: Create, elementSize: number, length: number): void {
  const arraysPerRound = 500;
  const retainedPerRound = arraysPerRound / 4;
  const retained: View[] = [];
  let wrong = 0;
  for (let round = 1; round <= 4; round++) {
    for (let i = 0; i < arraysPerRound; i++) {
      const view = create(length);
      if (view.length !== length || view.byteLength !== length * elementSize || view.byteOffset !== 0) wrong++;
      wrong += countOtherElements(view, 0);
      view.fill(round);
      if (i % 4 === 0) retained.push(view);
    }
    edenGC();
  }
  retained.forEach((view, index) => { wrong += countOtherElements(view, 1 + Math.floor(index / retainedPerRound)); });
  const last = retained[retained.length - 1];
  const bufferLength = last.buffer.byteLength;
  wrong += countOtherElements(last, 4);
  console.log(name, length, "wrong:", wrong, "length:", last.length, "byteLength:", last.byteLength, "buffer:", bufferLength);
}

function lengthOrError(create: Create, length: number): string {
  try {
    const view = create(length);
    return "length " + view.length + ", byteLength " + view.byteLength;
  } catch (error) {
    return (error as Error).name;
  }
}

const kinds: [string, Create, number][] = [["Uint8Array", createBytes, 1], ["Int16Array", createShorts, 2], ["Float64Array", createDoubles, 8]];
for (const [name, create, elementSize] of kinds) {
  for (const length of [0, 1, 7, 32, 33, 256, 257]) check(name, create, elementSize, length);
  for (const length of [1.5, -1, NaN, 2 ** 32, -0]) console.log(name, length, lengthOrError(create, length));
}
