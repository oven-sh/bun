// The slow way of a store, a push or a call takes its arguments in the registers that the parameters of the function arrived in, and the function reads the parameters behind it.
function put(list: number[], index: number, value: number): number {
  list[index] = value;
  return index;
}

function putAndAdd(list: number[], index: number, value: number, first: number, second: number, third: number): number {
  list[index] = value;
  return index + first * 2 + second * 3 + third * 5 + list.length * 7;
}

function set(list: unknown[], index: number, value: unknown, other: unknown): unknown {
  list[index] = value;
  return other;
}

function setTwice(list: unknown[], index: number, value: unknown, other: string, last: number): string {
  list[index] = value;
  list[index + last] = other;
  return other + index + ":" + last + ":" + String(value);
}

function add(list: unknown[], entry: unknown, next: unknown): unknown {
  list.push(entry);
  return next;
}

function addBoth(list: unknown[], first: unknown, second: unknown, tag: string, count: number): string {
  list.push(first);
  list.push(second);
  return tag + count + ":" + list.length + ":" + String(first) + String(second);
}

function turned(first: number, second: string, third: number, fourth: string): string {
  return fourth + third + second + first;
}

function handsOnTurned(first: number, second: string, third: number, fourth: string): string {
  let made = "";
  if (first > 96) made = turned(third, fourth, first, second);
  return made + first + second + third + fourth;
}

function refuse(code: number, name: string, extra: number): never {
  throw new RangeError(name + code + ":" + extra);
}

function checked(value: number, limit: number, name: string): string {
  try {
    if (value > limit) refuse(limit, name, value);
  } catch (error) {
    return (error as Error).message + "|" + value + "|" + limit + "|" + name;
  }
  return name + value + limit;
}

let digest = 0;
function note(text: unknown) {
  for (const unit of String(text)) digest = (digest * 31 + unit.charCodeAt(0)) | 0;
}

const doubles: number[] = [0.5, 1.5];
const whole: number[] = [1, 2];
const mixed: unknown[] = ["a", 1];
const sparse: number[] = [0.5];
for (let round = 0; round < 100; round++) {
  note(put(doubles, round, round + 0.5));
  note(put(doubles, round >> 1, round % 7 ? round : NaN));
  note(put(whole, round, round % 9 ? round : round + 0.25));
  note(put(sparse, round * 3, round + 0.75));
  note(putAndAdd(doubles, round + 1, round * 1.5, round, round + 1, round + 2));
  note(putAndAdd(whole, round * 2, round, round + 3, round + 4, round + 5));
  note(set(mixed, round, round % 3 ? round : "text" + round, round % 5 ? "other" + round : round));
  note(setTwice(mixed, round * 2, round % 4 ? round + 0.5 : { round }, "s" + round, (round & 3) + 1));
  note(add(mixed, round % 6 ? round : [round], "next" + round));
  note(addBoth(mixed, round, "second" + round, "tag", round * 2));
  note(handsOnTurned(round, "b" + round, round * 2, "d" + round));
  note(checked(round, 90, "name" + round));
}
console.log(digest, doubles.length, whole.length, mixed.length, sparse.length);
console.log(doubles.slice(0, 6).join(), whole.slice(0, 6).join(), sparse.slice(0, 7).join(), JSON.stringify(mixed.slice(0, 6)));
