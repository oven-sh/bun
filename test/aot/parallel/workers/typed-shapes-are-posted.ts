// Objects of many declared shapes are posted, cloned and compared with JSON: fields of numbers, whole numbers, texts, booleans, unions, optional fields, tuples, lists of numbers and of objects, objects inside objects, constants of the program, objects that never left their function before, instances with private fields and accessors.
type Inner = { a: number; b: number };
type Holder = { left: Inner; right: Inner; name: string };
type Wide = { f0: number; f1: string; f2: boolean; f3: null; f4: undefined; f5: bigint; f6: number[]; f7: string[]; f8: Inner[]; f9: Inner | null; f10?: number; f11: number | string; f12: [number, string]; f13: { deep: { deeper: { deepest: number } } }; f14: Date; f15: Map<string, Inner>; f16: Set<number>; f17: Uint8Array; f18: readonly number[]; f19: "a" | "b" };
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "none" };
interface Linked {
  value: number;
  next?: Linked;
}
class Account {
  #balance = 10;
  readonly id: number;
  owner: { name: string; tags: string[] };
  static count = 0;
  constructor(id: number) {
    this.id = id;
    this.owner = { name: "o" + id, tags: ["t"] };
    Account.count++;
  }
  get balance(): number {
    return this.#balance;
  }
}
const constants = { list: [1, 2, 3], doubles: [1.5, 2.5], texts: ["a", "b"], nested: { x: 1, y: [{ z: 2 }] }, empty: [], none: {} } as const;
const frozen = Object.freeze({ a: 1, list: Object.freeze([1, 2]) });
const tableOfObjects: Inner[] = [{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 6 }];

function show(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v + "n" : v instanceof Map ? { map: [...v] } : v instanceof Set ? { set: [...v] } : v === undefined ? "undefined!" : Object.is(v, -0) ? "-0!" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
}
function makers(seed: number): Record<string, () => unknown> {
  return {
    inner: (): Inner => ({ a: seed, b: seed + 0.5 }),
    holder: (): Holder => ({ left: { a: 1, b: 2 }, right: { a: seed, b: -0 }, name: "h" }),
    "one inner object twice": () => { const inner: Inner = { a: 1, b: 2 }; const holder: Holder = { left: inner, right: inner, name: "same" }; const copy = structuredClone(holder); return [holder, copy.left === copy.right]; },
    wide: (): Wide => ({ f0: seed, f1: "s", f2: true, f3: null, f4: undefined, f5: 5n, f6: [1, 2, seed], f7: ["x"], f8: [{ a: 1, b: 2 }], f9: null, f11: seed % 2 ? 1 : "one", f12: [1, "t"], f13: { deep: { deeper: { deepest: seed } } }, f14: new Date(seed), f15: new Map([["k", { a: 1, b: 2 }]]), f16: new Set([seed]), f17: new Uint8Array([seed]), f18: [1, 2], f19: "a" }),
    shapes: (): Shape[] => [{ kind: "circle", radius: seed }, { kind: "square", side: 2 }, { kind: "none" }],
    linked: (): Linked => ({ value: 1, next: { value: 2, next: { value: seed } } }),
    "whole numbers": (): number[] => [1, 2, 3, seed],
    "whole numbers that grow": () => { const list: number[] = [1, 2]; list.push(2 ** 31); list.push(0.5); return list; },
    doubles: (): number[] => [0.5, -0, NaN, Infinity, seed],
    "small whole numbers": (): number[] => Array.from({ length: 40 }, (_, i) => i % 7),
    booleans: (): boolean[] => [true, false, seed > 0],
    "texts in a list": (): string[] => ["a", "b" + seed, ""],
    "a list of lists": (): number[][] => [[1], [2, 3], [], [seed]],
    "a list of tuples": (): [number, string][] => [[1, "a"], [seed, "b"]],
    "a list with a hole": () => { const list: (number | undefined)[] = [1, 2, 3]; delete list[1]; return [list, 1 in structuredClone(list)]; },
    "a list cut short": () => { const list: Inner[] = [{ a: 1, b: 1 }, { a: 2, b: 2 }, { a: 3, b: 3 }]; list.length = 1; return list; },
    "a list that was shifted": () => { const list: number[] = [1, 2, 3, 4, 5]; list.shift(); list.shift(); list.unshift(seed); return list; },
    "an empty list that was long": () => { const list: number[] = Array.from({ length: 100 }, (_, i) => i); list.length = 0; return list; },
    account: () => new Account(seed),
    accounts: () => [new Account(1), new Account(2)].map(account => ({ account, balance: account.balance })),
    constants: () => constants,
    "a part of the constants": () => [constants.list, constants.nested.y, constants.nested.y[0]],
    "the table of objects": () => tableOfObjects,
    frozen: () => [frozen, Object.isFrozen(structuredClone(frozen))],
    "an optional field set later": () => { const wide: { a: number; b?: string; c?: Inner } = { a: 1 }; wide.c = { a: seed, b: 2 }; return wide; },
    "a field of a union that changes its kind": () => { const box: { value: number | string | Inner | null } = { value: 1 }; const all = [structuredClone(box)]; box.value = "text"; all.push(structuredClone(box)); box.value = { a: 1, b: 2 }; all.push(structuredClone(box)); box.value = null; all.push(structuredClone(box)); box.value = 1.5; all.push(structuredClone(box)); return all; },
    "a number field that holds every kind of number": () => [0, -0, 1, -1, 0.1, 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 53, NaN, Infinity, 1e-320].map((n): Inner => ({ a: n, b: -n })),
    "spread and rest": () => { const { a, ...rest } = { a: 1, b: seed, c: "c" }; return [{ ...rest, a }, rest]; },
    "computed keys": () => ({ ["k" + seed]: 1, [seed]: 2, [`t${seed}`]: { a: 1, b: 2 } as Inner }),
    "a record": (): Record<string, Inner> => Object.fromEntries([["x", { a: 1, b: 2 }], ["y", { a: seed, b: 4 }]]),
    "class fields of every kind": () => new (class { n = seed; s = "s"; b = false; u = undefined; z = null; l = [1]; o = { a: 1, b: 2 } as Inner; f = 1.5; big = 1n })(),
    "an heir": () => new (class Savings extends Account { rate = 0.5; constructor() { super(seed); } })(),
    "an object with many fields": () => Object.fromEntries(Array.from({ length: 100 }, (_, i) => ["f" + i, i % 3 ? i : "t" + i])),
    "a literal with forty fields": () => ({ a0: 0, a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7, a8: 8, a9: 9, b0: "0", b1: "1", b2: "2", b3: "3", b4: "4", b5: "5", b6: "6", b7: "7", b8: "8", b9: "9", c0: 0.5, c1: 1.5, c2: 2.5, c3: 3.5, c4: 4.5, c5: 5.5, c6: 6.5, c7: 7.5, c8: 8.5, c9: 9.5, d0: true, d1: false, d2: null, d3: [0], d4: {}, d5: seed, d6: -0, d7: NaN, d8: "", d9: 9n }),
  };
}

if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const ask = (message: unknown) => new Promise<any>(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.postMessage(message);
  });
  let rounds = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const all = makers(seed);
    for (const name of Object.keys(all)) {
      const here = show(all[name]());
      const cloned = show(structuredClone(all[name]()));
      const answer = await ask({ name, seed, value: all[name]() });
      rounds++;
      if (seed === 1) console.log(name, here);
      if (cloned !== here) console.log("CLONED", name, seed, cloned);
      if (answer.there !== here) console.log("THERE", name, seed, answer.there);
      if (show(answer.back) !== here) console.log("BACK", name, seed, show(answer.back));
      if (show(answer.made) !== here) console.log("MADE THERE", name, seed, show(answer.made));
    }
  }
  console.log("rounds:", rounds);
  worker.terminate();
} else {
  addEventListener("message", (event: MessageEvent<{ name: string; seed: number; value: unknown }>) => {
    const { name, seed, value } = event.data;
    postMessage({ there: show(value), back: value, made: makers(seed)[name]() });
  });
}
