// One access, two kinds of receiver, both as declared: a record of the program and an object of a built-in class or of the host. Whichever arrives, the rest of the function answers the same.
interface State { count: number; last: string; seen: number[] }
type Sized = { size: number; label: string } | Map<string, number> | Set<number>;
type Linked = { href: string; hash: string } | URL;
type Timed = { getTime(): number; tag?: string } | Date;
type Lengthy = { length: number; kind: string } | Uint8Array | string[];

function sizeOf(value: Sized, state: State): number {
  const size = value.size;
  state.count += size;
  state.last = "size " + size;
  state.seen.push(size);
  return state.count;
}
function linkOf(value: Linked, state: State): string {
  const href = value.href;
  state.count++;
  state.last = href + value.hash;
  return state.last + state.count;
}
function timeOf(value: Timed, state: State): number {
  const time = value.getTime();
  state.count += time % 7;
  state.last = String(time);
  return state.count;
}
function lengthOf(value: Lengthy, state: State): number {
  const length = value.length;
  state.count += length;
  state.seen.push(length);
  return state.seen.length + state.count;
}
function mark(value: Sized & { mark?: number }, state: State, n: number): number {
  value.mark = n;
  state.count += value.mark;
  return state.count;
}
function maybe(value: Sized | null | undefined, state: State): string {
  try {
    const size = value!.size;
    state.count += size;
    return "size " + size + " count " + state.count;
  } catch (error) {
    state.count--;
    return (error as Error).constructor.name + " count " + state.count;
  }
}

const state: State = { count: 0, last: "", seen: [] };
const sized: Sized[] = [{ size: 3, label: "record" }, new Map([["a", 1], ["b", 2]]), new Set([1, 2, 3, 4]), { size: 5, label: "other" }];
const linked: Linked[] = [{ href: "record:", hash: "#r" }, new URL("https://example.com/path#u")];
const timed: Timed[] = [{ getTime: () => 11 }, new Date(86400000), { getTime: () => 13, tag: "t" }];
const lengthy: Lengthy[] = [{ length: 2, kind: "record" }, new Uint8Array(6), ["a", "b", "c"]];
const lines: string[] = [];
for (let round = 0; round < 400; round++) {
  const a = sizeOf(sized[round % sized.length], state);
  const b = linkOf(linked[round % linked.length], state);
  const c = timeOf(timed[round % timed.length], state);
  const d = lengthOf(lengthy[round % lengthy.length], state);
  const e = mark(sized[(round + 1) % sized.length], state, round & 3);
  const f = maybe(round % 5 === 0 ? null : round % 7 === 0 ? undefined : sized[round % sized.length], state);
  if (round < 8 || round > 395) lines.push([a, b, c, d, e, f, state.last].join(" | "));
}
// Only objects of built-in classes for a while, then only records.
for (let round = 0; round < 300; round++) sizeOf(sized[1 + (round & 1)], state);
for (let round = 0; round < 300; round++) sizeOf(sized[(round & 1) * 3], state);
console.log(lines.join("\n"));
console.log(state.count, state.last, state.seen.length, (sized[1] as any).mark, (sized[0] as any).mark, Object.keys(sized[0]).join());
