// An object that has grown old gets the error that an operation has just thrown. The error is as young as can be, and the store stands behind a handler: it needs its write barrier.
import { edenGC } from "bun:jsc";

class Box {
  #secret = 1;
  static read(value: any): number {
    return value.#secret;
  }
}

class Holder {
  first: object | null = null;
  error: any = null;
  tag: number;
  constructor(tag: number) {
    this.tag = tag;
  }
}

function run(holders: Holder[], values: object[], wrong: object): number {
  let caught = 0;
  for (let index = 0; index < holders.length; index++) {
    const holder = holders[index];
    holder.first = values[index];
    let thrown: any = null;
    try {
      caught += Box.read(wrong);
    } catch (error) {
      thrown = error;
    }
    holder.error = thrown;
  }
  return caught;
}

function fill(depth: number): number {
  const some = [depth, depth + 1, depth + 2, depth + 3, depth + 4, depth + 5];
  return depth ? fill(depth - 1) + some.length : some.length;
}

let total = 0;
let lengths = 0;
for (let round = 0; round < 60; round++) {
  const holders: Holder[] = [];
  const values: object[] = [];
  for (let index = 0; index < 40; index++) {
    holders.push(new Holder(index));
    values.push({ index });
  }
  total += run(holders, values, {});
  total += fill(30);
  edenGC();
  for (let more = 0; more < 100; more++) total += new TypeError("filler " + more).message.length;
  for (const each of holders) lengths += (String(each.error.message).length > 0 ? 1 : 1000) + (each.error instanceof TypeError ? 1 : 1000000) + (each.first as any).index;
}
console.log(total, lengths);
