// `list.sort((a, b) => a - b)` in its spellings, on every kind of list, beside comparators that only look like it.
function show(list: unknown): string {
  if (!Array.isArray(list)) return String(list);
  let text = "";
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    text +=
      (i ? "," : "") +
      (i in list ? (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value)) : "hole");
  }
  return `[${text}]`;
}
function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return `${(error as Error).constructor.name}: ${(error as Error).message}`;
  }
}
function scrambled(length: number, divisor: number): number[] {
  const list: number[] = [];
  let seed = 12345;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    list.push(((seed >> 8) % 1000) / divisor);
  }
  return list;
}
function checksum(list: number[]): string {
  let sum = 0;
  let isOrdered = true;
  for (let i = 0; i < list.length; i++) {
    sum = (sum * 31 + list[i] * 4) % 1000003;
    if (i && list[i - 1] > list[i]) isOrdered = false;
  }
  return `${list.length}:${sum}:${isOrdered}`;
}

function named(a: number, b: number) {
  return a - b;
}
const kept = (a: number, b: number) => b - a;

console.log(show([5, 3, 9, 1, 4].sort((a, b) => a - b)), show([5, 3, 9, 1, 4].sort((a, b) => b - a)));
console.log(
  show([5.5, 3.25, -9, 1e300, -1e300, 4].sort((a, b) => a - b)),
  show([5.5, 3.25, -9, 4].sort((a, b) => b - a)),
);
console.log(show([2, 1].sort(named)), show([1.5, 2.5, 0.5].sort(named)), show([1, 3, 2].sort(kept)));
console.log(
  show(
    [3, 1, 2].sort(function (x, y) {
      return x - y;
    }),
  ),
  show(([3, 1, 2] as any).sort((a: any, b: any) => a - b)),
);
console.log(
  show([0, -0, 0, -0].sort((a, b) => a - b)),
  show([-0, 0, -0.0, 0.5, 0].sort((a, b) => b - a)),
  show([0.5, -0, 0].sort((a, b) => a - b)),
);
console.log(
  show([Infinity, -Infinity, 0, Infinity, 1.5].sort((a, b) => a - b)),
  show([3, NaN, 1, NaN, 2].sort((a, b) => a - b)),
);
// A comparison with NaN says neither: the answer depends on the order that the list had.
console.log(
  show([4.5, 1.5, 0.5, 1.5, 5.5, NaN, 3.5, 3.5, 2.5].sort((a, b) => a - b)),
  show([8.5, 3.5, 4.5, 5.5, 2.5, NaN, 2.5, 5.5].sort((a, b) => a - b)),
);
console.log(
  show([7.5, 1.5, 5.5, NaN, 0.5, 5.5, 4.5, 3.5, NaN, 0.5].sort((a, b) => a - b)),
  show([0.5, 6.5, 2.5, NaN, 5.5, 3.5, 3.5, NaN, 5.5].sort((a, b) => b - a)),
);
let seedOfLists = 7;
const nextOfLists = (n: number) => ((seedOfLists = (seedOfLists * 1103515245 + 12345) & 0x7fffffff) >> 8) % n;
let textOfLists = "";
for (let round = 0; round < 300; round++) {
  const list: number[] = [];
  for (let i = 3 + nextOfLists(30); i > 0; i--) list.push(nextOfLists(6) === 0 ? NaN : nextOfLists(9) + 0.5);
  round & 1 ? list.sort((a, b) => a - b) : list.sort((a, b) => b - a);
  textOfLists = String(Bun.hash(textOfLists + list.join()));
}
console.log(textOfLists);
console.log(
  show([3, 1, NaN, 0].sort((a, b) => a - b)),
  show([5, 4, 3, NaN, 2, 1].sort((a, b) => a - b)),
  show([1, 2, NaN, 0, 9, -1].sort((a, b) => b - a)),
);
console.log(
  show([9.5, 8.5, 7.5, 6.5, NaN, 5.5, 4.5, NaN, 3.5].sort((a, b) => a - b)),
  show([2, 1, 0, -1, -2, NaN].sort((a, b) => a - b)),
);
console.log(
  show([Infinity, Infinity, 1, -Infinity, -Infinity].sort((a, b) => a - b)),
  show([5e-324, 0, -5e-324, 1e-320].sort((a, b) => a - b)),
  show([1e308, -1e308, 1.7e308].sort((a, b) => b - a)),
);
// biome-ignore format: the holes are the point
console.log(show([4, 3, 2, , 1, 0].sort((a, b) => a! - b!)), show([4.5, 3.5, , 2.5, 0.5].sort((a, b) => b! - a!)));
console.log(show([].sort((a, b) => a - b)), show([7].sort((a, b) => a - b)), show([7.5].sort((a, b) => b - a)));
// biome-ignore format: the holes are the point
console.log(
  show([3, , 1].sort((a, b) => a! - b!)),
  show([3.5, , 1.5, , 2.5].sort((a, b) => a! - b!)),
  show([3, undefined, 1].sort((a, b) => a! - b!)),
);
for (const length of [2, 7, 8, 9, 63, 64, 65, 200]) {
  console.log(
    checksum(scrambled(length, 1).sort((a, b) => a - b)),
    checksum(scrambled(length, 8).sort((a, b) => a - b)),
    checksum(
      scrambled(length, 8)
        .sort((a, b) => b - a)
        .reverse(),
    ),
  );
}

const same = [3, 1, 2];
console.log(same.sort((a, b) => a - b) === same, show(same));
function literal() {
  return [3, 1, 2, 0.5];
}
function wholeLiteral() {
  return [9, 8, 7];
}
for (let i = 0; i < 3; i++)
  console.log(
    show(literal().sort((a, b) => a - b)),
    show(literal()),
    show(wholeLiteral().sort((a, b) => a - b)),
    show(wholeLiteral()),
  );

console.log(attempt(() => (Object.freeze([3, 1, 2]) as number[]).sort((a, b) => a - b)));
console.log(attempt(() => (Object.freeze([1.5, 2.5]) as number[]).sort((a, b) => a - b)));
console.log(
  attempt(() => Object.seal([3, 1, 2]).sort((a, b) => a - b)),
  attempt(() => Object.preventExtensions([3.5, 1, 2]).sort((a, b) => b - a)),
);
console.log(
  attempt(() => ["10", "9", "1"].sort((a: any, b: any) => a - b)),
  attempt(() => [3, "2", 1.5, null, true].sort((a: any, b: any) => a - b)),
);
console.log(
  attempt(() => [3n, 1n, 2n].sort((a: any, b: any) => a - b)),
  attempt(() => [3, 1n].sort((a: any, b: any) => a - b)),
);
console.log(attempt(() => [Symbol("s"), 1].sort((a: any, b: any) => a - b)));

const log: string[] = [];
const boxed = [3, 1, 2].map(n => ({
  valueOf() {
    log.push("v" + n);
    return n;
  },
}));
console.log(show(boxed.sort((a: any, b: any) => a - b).map(Number)), log.join(""));

function framesSeen() {
  let frames = "";
  const watcher = {
    valueOf() {
      frames ||= new Error("x")
        .stack!.split("\n")
        .slice(1, 5)
        .map(line => line.trim().split(" ")[1])
        .join("<");
      return 1;
    },
  };
  [watcher, watcher].sort((a: any, b: any) => a - b);
  return frames.replace(/<[^<]*[/\\][^<]*$/, "");
}
console.log(framesSeen());

let calls = 0;
console.log(
  show(
    [3, 1, 2].sort((a, b) => {
      calls++;
      return a - b;
    }),
  ),
  calls,
);
console.log(
  show([3, 1, 2].sort((a, b) => a - b + 0)),
  show([3, 1, 2].sort((a, b) => a - a)),
  show([3, 1, 2].sort((a, b) => -(a - b))),
);
console.log(
  show([3, 1, 2].sort((a, b, c?: number) => a - b)),
  show([3, 1, 2].sort((a, b = 2) => a - b)),
  show([3, 1, 2].sort((...both: number[]) => both[0] - both[1])),
);
console.log(
  show(
    [3, 1, 2].sort(function (a, b) {
      return arguments[1] - a;
    }),
  ),
);
let changing = (a: number, b: number) => a - b;
console.log(show([3, 1, 2].sort(changing)));
changing = (a, b) => b - a;
console.log(show([3, 1, 2].sort(changing)));

class Numbers extends Array<number> {}
console.log(
  show(Numbers.from([3, 1, 2]).sort((a, b) => a - b)),
  Numbers.from([2, 1]).sort((a, b) => a - b) instanceof Numbers,
);
console.log(
  show(Array.from(Array.prototype.sort.call({ length: 3, 0: 3, 1: 1, 2: 2 }, (a, b) => a - b) as ArrayLike<number>)),
);
console.log(
  new Float64Array([3, 1.5, 2]).sort((a, b) => a - b).join(),
  new Int8Array([3, -1, 2]).sort((a, b) => b - a).join(),
);
const withName: any = [3, 1, 2];
withName.label = "kept";
console.log(show(withName.sort((a: number, b: number) => a - b)), withName.label);
const sparse: number[] = [];
sparse[100] = 1;
sparse[50] = 2;
console.log(sparse.sort((a, b) => a - b).length, sparse[0], sparse[1], 2 in sparse);
const grown: number[] = [];
for (let i = 0; i < 20; i++) grown.push((i * 7) % 20);
grown.length = 10;
console.log(show(grown.sort((a, b) => a - b)));
