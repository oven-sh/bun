const names: string[] = JSON.parse('["w", "other", "v"]');
const log: unknown[] = [];

class Inherits {
  v: number;
  declare w?: number;
  constructor(v: number) {
    this.v = v;
  }
}
(Inherits.prototype as any)[names[0]] = 100;

class Unrelated {
  v: number;
  declare w?: number;
  constructor(v: number) {
    this.v = v;
  }
}
(Unrelated.prototype as any)[names[1]] = 100;

class HasSetter {
  v: number;
  declare w?: number;
  constructor(v: number) {
    this.v = v;
  }
}
Object.defineProperty(HasSetter.prototype, names[0], {
  get() {
    return 5;
  },
  set(value: unknown) {
    log.push(value);
  },
});

class ReadOnly {
  v: number;
  declare w?: number;
  constructor(v: number) {
    this.v = v;
  }
}
Object.defineProperty(ReadOnly.prototype, names[0], { value: 9, writable: false });

class Filled {
  v: number;
  declare w?: number;
  constructor(v: number, w?: number) {
    this.v = v;
    if (w !== undefined) this.w = w;
  }
}
(Filled.prototype as any)[names[0]] = 100;

function sum(o: { v: number; w?: number }): number {
  return o.v + (o.w ?? 7);
}

function attempt(run: () => number): string {
  try {
    return String(run());
  } catch (error) {
    return error instanceof Error ? error.constructor.name : typeof error;
  }
}

const kept: object[] = [];
for (let x = 0; x < 3; x++) {
  console.log("read", sum(new Inherits(x)), sum(new Unrelated(x)), sum(new HasSetter(x)), sum(new ReadOnly(x)), sum(new Filled(x)), sum(new Filled(x, 1)));
  console.log(
    "store",
    attempt(() => {
      const o = new Inherits(x);
      o.w = x + 1;
      return sum(o);
    }),
    attempt(() => {
      const o = new Unrelated(x);
      o.w = x + 1;
      return sum(o);
    }),
    attempt(() => {
      const o = new HasSetter(x);
      o.w = x + 1;
      return sum(o);
    }),
    attempt(() => {
      const o = new ReadOnly(x);
      o.w = x + 1;
      return sum(o);
    }),
  );
  const escaping = new Unrelated(x);
  escaping.w = x + 2;
  kept.push(escaping);
  const intercepted = new HasSetter(x);
  intercepted.w = x + 3;
  kept.push(intercepted);
}
console.log(JSON.stringify(kept), JSON.stringify(log), kept.map(o => Object.keys(o).join()).join(" "));
