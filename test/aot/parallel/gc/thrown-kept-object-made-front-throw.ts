// Errors thrown by a private name, by a call of what is no function and by a read of null are kept in literals that were made in front of the throw, over young collections.
import { edenGC } from "bun:jsc";

class Box {
  #secret = 1;
  static read(value: any): number {
    return value.#secret;
  }
}

type Holder = { error: any; tag: number };

function fill(depth: number): number {
  const some = [depth, depth + 1, depth + 2, depth + 3, depth + 4, depth + 5];
  return depth ? fill(depth - 1) + some.length : some.length;
}

function byPrivateName(value: object, tag: number): Holder {
  const holder: Holder = { error: null, tag };
  try {
    Box.read(value);
  } catch (error) {
    holder.error = error;
  }
  return holder;
}

function byCall(value: any, tag: number): Holder {
  const holder: Holder = { error: null, tag };
  try {
    value();
  } catch (error) {
    holder.error = error;
  }
  return holder;
}

function byNull(value: any, tag: number): Holder {
  const holder: Holder = { error: null, tag };
  try {
    holder.tag = value.length;
  } catch (error) {
    holder.error = error;
  }
  return holder;
}

const kept: Holder[] = [];
let total = 0;
for (let step = 0; step < 300; step++) {
  kept.push(byPrivateName({}, step), byCall(step, step), byNull(null, step));
  total += fill(30);
  if (step % 10 === 9) {
    edenGC();
    for (let more = 0; more < 200; more++) total += new Error("filler " + more).message.length;
  }
}
let lengths = 0;
for (const each of kept) lengths += (String(each.error.message).length > 0 ? 1 : 1000) + (each.error instanceof TypeError ? 1 : 1000000);
console.log(kept.length, total, lengths);
