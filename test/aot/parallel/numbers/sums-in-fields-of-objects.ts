// STATISTIC: UnrolledLoopStoresSunk >= 4
// Sums of integers in fields: the store may move behind the unrolled iterations. The field is read inside and after the loop, through other names, after a break and after a throw.
const show = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
const list: number[] = Array.from({ length: 40 }, (_, i) => i * 37 - 500);
const words = new Int32Array(list);
class Counter {
  n: number;
  m = 0;
  #p: number;
  constructor(n: number) {
    this.n = n;
    this.#p = n;
  }
  publicSum(k: number): number {
    for (let i = 0; i < k; i++) this.n += i & 3;
    return this.n;
  }
  privateSum(k: number): number {
    for (let i = 0; i < k; i++) this.#p += i & 3;
    return this.#p;
  }
  both(k: number): number {
    for (let i = 0; i < k; i++) {
      this.n += i & 3;
      this.m += i & 1;
    }
    return this.n * 1000 + this.m;
  }
  ofWords(k: number): number {
    for (let i = 0; i < k; i++) this.n += words[i]!;
    return this.n;
  }
  readsOther(other: Counter, k: number): number {
    let seen = 0;
    for (let i = 0; i < k; i++) {
      this.n += i & 7;
      seen += other.n;
    }
    return seen;
  }
  writesOther(other: Counter, k: number): string {
    for (let i = 0; i < k; i++) {
      this.n += i & 7;
      other.n += 1;
    }
    return show(this.n) + " " + show(other.n);
  }
  copies(k: number): number {
    for (let i = 0; i < k; i++) {
      this.n += i & 7;
      this.m = this.n;
    }
    return this.m;
  }
  breaks(k: number, at: number): number {
    for (let i = 0; i < k; i++) {
      this.n += i & 7;
      if (i === at) break;
    }
    return this.n;
  }
  throws(k: number, objects: ({ a: number } | undefined)[]): string {
    try {
      for (let i = 0; i < k; i++) {
        this.n += i & 7;
        this.m += objects[i]!.a & 3;
      }
    } catch {
      return "threw " + show(this.n) + " " + show(this.m);
    }
    return show(this.n) + " " + show(this.m);
  }
  falls(k: number): number {
    for (let i = k; i > 0; i--) this.n = this.n + (i & 15);
    return this.n;
  }
}
const starts: number[] = [0, 1, -7, 0.5, -0, 2 ** 31, 2 ** 52 - 3, 2 ** 53, -(2 ** 53), NaN, Infinity];
const objects: ({ a: number } | undefined)[] = Array.from({ length: 30 }, (_, i) => ({ a: i }));
for (const start of starts) {
  const line: string[] = [];
  for (const k of [0, 1, 3, 4, 9, 40]) {
    const c = () => new Counter(start);
    line.push(show(c().publicSum(k)), show(c().privateSum(k)), show(c().both(k)), show(c().ofWords(k)), show(c().copies(k)), show(c().breaks(k, 5)), show(c().falls(k)));
    const alias = c();
    line.push(show(alias.readsOther(alias, k)), alias.writesOther(alias, k), show(c().readsOther(c(), k)), c().writesOther(c(), k), c().throws(Math.min(k, 30), objects), c().throws(k, objects.slice(0, 7)));
    const kept = c();
    kept.publicSum(k);
    kept.publicSum(k + 1);
    line.push(show(kept.n));
  }
  console.log(line.join(" "));
}
class Shared {
  static total = 0;
  static add(k: number): number {
    for (let i = 0; i < k; i++) Shared.total += i & 3;
    return Shared.total;
  }
}
for (const k of [0, 5, 100]) console.log(Shared.add(k));
const frozen = Object.freeze(new Counter(3));
try {
  frozen.publicSum(20);
} catch (error) {
  console.log((error as Error).constructor.name, frozen.n);
}
const proxied: Counter = new Proxy(new Counter(1), { set: (target, key, value) => Reflect.set(target, key, (value as number) + 1) });
console.log(proxied.publicSum(9));

class Steady {
  n = 0;
  m = 0;
  #p = 0;
  sum(k: number): number {
    for (let i = 0; i < k; i++) this.n += i & 3;
    return this.n;
  }
  hidden(k: number): number {
    for (let i = 0; i < k; i++) this.#p += i & 3;
    return this.#p;
  }
  two(k: number): number {
    for (let i = 0; i < k; i++) {
      this.n += i & 7;
      this.m += i & 3;
    }
    return this.n * 1000 + this.m;
  }
  reads(other: Steady, k: number): number {
    let seen = 0;
    for (let i = 0; i < k; i++) {
      this.n += i & 7;
      seen += other.n;
    }
    return seen;
  }
  readsFirst(other: Steady, k: number): number {
    let seen = 0;
    for (let i = 0; i < k; i++) {
      seen = other.n;
      this.n += i & 7;
    }
    return seen;
  }
  writes(other: Steady, k: number): number {
    for (let i = 0; i < k; i++) {
      this.n += i & 7;
      other.n = i & 1;
    }
    return this.n;
  }
}
const steady = new Steady(), second = new Steady();
let all = 0;
for (let turn = 0; turn < 40; turn++) {
  all += steady.sum(40) + steady.hidden(37) + steady.two(turn) + second.sum(3);
  all += steady.reads(turn & 1 ? steady : second, 40) + second.reads(steady, 37) + steady.readsFirst(turn & 1 ? steady : second, 33) + second.writes(turn & 2 ? second : steady, 35);
}
console.log(all, steady.n, steady.m, second.n, second.m, steady.hidden(0));
