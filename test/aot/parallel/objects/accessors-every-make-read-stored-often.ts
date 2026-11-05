// Accessors, own and inherited, made in every way the language has, read and stored by every kind of assignment: once, and then many times over.
type Held = { inner: number; log: number; value: number };
const lines: string[] = [];
const attempt = (action: () => unknown): string => {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};

const literal = (): Held => ({
  inner: 1,
  log: 0,
  get value() {
    this.log++;
    return this.inner;
  },
  set value(n: number) {
    this.log += 100;
    this.inner = n * 2;
  },
});
const withClosures = (): Held => {
  const o = { inner: 1, log: 0 } as Held;
  let reads = 0;
  return Object.defineProperty(o, "value", {
    get: () => ((o.log = ++reads), o.inner),
    set: (n: number) => {
      reads += 100;
      o.inner = n * 3;
    },
    enumerable: true,
    configurable: true,
  });
};
const hidden = (): Held =>
  Object.defineProperty({ inner: 1, log: 0 } as Held, "value", {
    get(this: Held) {
      return this.inner + 1;
    },
    set(this: Held, n: number) {
      this.log++;
      this.inner = n;
    },
  });
const oneAfterTheOther = (): Held => {
  const o = { inner: 1, log: 0 } as Held;
  Object.defineProperty(o, "value", { get: () => o.inner, configurable: true });
  Object.defineProperty(o, "value", { set: (n: number) => void (o.inner = n + 10) });
  return o;
};
const byMap = (): Held =>
  Object.defineProperties({ inner: 1, log: 0 } as Held, {
    value: {
      get(this: Held) {
        return this.inner;
      },
      set(this: Held, n: number) {
        this.inner = n - 1;
      },
    },
  });
class Declared implements Held {
  inner = 1;
  log = 0;
  get value() {
    return this.inner;
  }
  set value(n: number) {
    this.log++;
    this.inner = n + 1;
  }
}
class Below extends Declared {
  override set value(n: number) {
    super.value = n * 2;
  }
  override get value() {
    return super.value + 1;
  }
}
class InItsConstructor implements Held {
  inner = 1;
  log = 0;
  declare value: number;
  constructor() {
    Object.defineProperty(this, "value", { get: () => this.inner, set: (n: number) => void ((this.inner = n * 2), this.log++), enumerable: true, configurable: true });
  }
}
function Old(this: Held) {
  this.inner = 1;
  this.log = 0;
}
Object.defineProperty(Old.prototype, "value", {
  get(this: Held) {
    return this.inner;
  },
  set(this: Held, n: number) {
    this.inner = n + 2;
  },
});
const getterAlone = (): Held =>
  ({
    inner: 1,
    log: 0,
    get value() {
      return this.inner;
    },
  }) as Held;
const setterAlone = (): Held =>
  ({
    inner: 1,
    log: 0,
    set value(n: number) {
      this.inner = n;
    },
  }) as Held;

// Each maker has functions of its own, written out, so that each is compiled for what that maker makes.
{
  const make: () => Held = literal;
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`a literal once: ${attempt(() => all(make(), make(), 7))}`, `a literal often: ${attempt(often)}`, `a literal new each time: ${attempt(fresh)}`, `a literal behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = withClosures;
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`closures once: ${attempt(() => all(make(), make(), 7))}`, `closures often: ${attempt(often)}`, `closures new each time: ${attempt(fresh)}`, `closures behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = hidden;
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`hidden and fixed once: ${attempt(() => all(make(), make(), 7))}`, `hidden and fixed often: ${attempt(often)}`, `hidden and fixed new each time: ${attempt(fresh)}`, `hidden and fixed behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = oneAfterTheOther;
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`one half after the other once: ${attempt(() => all(make(), make(), 7))}`, `one half after the other often: ${attempt(often)}`, `one half after the other new each time: ${attempt(fresh)}`, `one half after the other behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = byMap;
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`a map of descriptors once: ${attempt(() => all(make(), make(), 7))}`, `a map of descriptors often: ${attempt(often)}`, `a map of descriptors new each time: ${attempt(fresh)}`, `a map of descriptors behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => new Declared();
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`a class once: ${attempt(() => all(make(), make(), 7))}`, `a class often: ${attempt(often)}`, `a class new each time: ${attempt(fresh)}`, `a class behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => new Below();
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`a class below once: ${attempt(() => all(make(), make(), 7))}`, `a class below often: ${attempt(often)}`, `a class below new each time: ${attempt(fresh)}`, `a class below behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => new InItsConstructor();
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`in its constructor once: ${attempt(() => all(make(), make(), 7))}`, `in its constructor often: ${attempt(often)}`, `in its constructor new each time: ${attempt(fresh)}`, `in its constructor behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => new (Old as unknown as new () => Held)();
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`a constructor function once: ${attempt(() => all(make(), make(), 7))}`, `a constructor function often: ${attempt(often)}`, `a constructor function new each time: ${attempt(fresh)}`, `a constructor function behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.create(literal());
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`below a literal once: ${attempt(() => all(make(), make(), 7))}`, `below a literal often: ${attempt(often)}`, `below a literal new each time: ${attempt(fresh)}`, `below a literal behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.create(withClosures());
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`below closures once: ${attempt(() => all(make(), make(), 7))}`, `below closures often: ${attempt(often)}`, `below closures new each time: ${attempt(fresh)}`, `below closures behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.create(Object.create(literal()));
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`two below once: ${attempt(() => all(make(), make(), 7))}`, `two below often: ${attempt(often)}`, `two below new each time: ${attempt(fresh)}`, `two below behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.assign({}, literal());
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`a copy by assign once: ${attempt(() => all(make(), make(), 7))}`, `a copy by assign often: ${attempt(often)}`, `a copy by assign new each time: ${attempt(fresh)}`, `a copy by assign behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => ({ ...literal() });
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`a copy by spread once: ${attempt(() => all(make(), make(), 7))}`, `a copy by spread often: ${attempt(often)}`, `a copy by spread new each time: ${attempt(fresh)}`, `a copy by spread behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(literal())) as Held;
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`a copy with its descriptors once: ${attempt(() => all(make(), make(), 7))}`, `a copy with its descriptors often: ${attempt(often)}`, `a copy with its descriptors new each time: ${attempt(fresh)}`, `a copy with its descriptors behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.freeze(literal());
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`frozen once: ${attempt(() => all(make(), make(), 7))}`, `frozen often: ${attempt(often)}`, `frozen new each time: ${attempt(fresh)}`, `frozen behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.freeze(withClosures());
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`frozen closures once: ${attempt(() => all(make(), make(), 7))}`, `frozen closures often: ${attempt(often)}`, `frozen closures new each time: ${attempt(fresh)}`, `frozen closures behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.seal(literal());
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`sealed once: ${attempt(() => all(make(), make(), 7))}`, `sealed often: ${attempt(often)}`, `sealed new each time: ${attempt(fresh)}`, `sealed behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.preventExtensions(literal());
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`no more names once: ${attempt(() => all(make(), make(), 7))}`, `no more names often: ${attempt(often)}`, `no more names new each time: ${attempt(fresh)}`, `no more names behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = getterAlone;
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`the getter alone once: ${attempt(() => all(make(), make(), 7))}`, `the getter alone often: ${attempt(often)}`, `the getter alone new each time: ${attempt(fresh)}`, `the getter alone behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = setterAlone;
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`the setter alone once: ${attempt(() => all(make(), make(), 7))}`, `the setter alone often: ${attempt(often)}`, `the setter alone new each time: ${attempt(fresh)}`, `the setter alone behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => {
  const o = literal();
  delete (o as Partial<Held>).value;
  return o;
};
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`deleted once: ${attempt(() => all(make(), make(), 7))}`, `deleted often: ${attempt(often)}`, `deleted new each time: ${attempt(fresh)}`, `deleted behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => {
  const o = literal();
  delete (o as Partial<Held>).value;
  return Object.defineProperty(o, "value", { get: () => o.inner, set: (n: number) => void (o.inner = -n), configurable: true });
};
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`deleted and defined anew once: ${attempt(() => all(make(), make(), 7))}`, `deleted and defined anew often: ${attempt(often)}`, `deleted and defined anew new each time: ${attempt(fresh)}`, `deleted and defined anew behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.defineProperty(literal(), "value", { value: 5, writable: true });
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`made a value once: ${attempt(() => all(make(), make(), 7))}`, `made a value often: ${attempt(often)}`, `made a value new each time: ${attempt(fresh)}`, `made a value behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.defineProperty(literal(), "value", { set: undefined });
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`the setter taken away once: ${attempt(() => all(make(), make(), 7))}`, `the setter taken away often: ${attempt(often)}`, `the setter taken away new each time: ${attempt(fresh)}`, `the setter taken away behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => Object.defineProperty(literal(), "value", { get: undefined });
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`the getter taken away once: ${attempt(() => all(make(), make(), 7))}`, `the getter taken away often: ${attempt(often)}`, `the getter taken away new each time: ${attempt(fresh)}`, `the getter taken away behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => {
  const o = literal();
  const { get, set } = Object.getOwnPropertyDescriptor(o, "value")!;
  return Object.defineProperty(o, "value", { get: set as () => number, set: get as (n: number) => void });
};
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`the halves changed places once: ${attempt(() => all(make(), make(), 7))}`, `the halves changed places often: ${attempt(often)}`, `the halves changed places new each time: ${attempt(fresh)}`, `the halves changed places behind it: ${attempt(() => all(make(), make(), 9))}`);
}
{
  const make: () => Held = () => {
  const o = literal();
  let turns = 0;
  const next = (n: number): void => {
    o.inner = n + ++turns;
    Object.defineProperty(o, "value", { set: turns & 1 ? (m: number) => void ((o.inner = -m), Object.defineProperty(o, "value", { set: next })) : next });
  };
  return Object.defineProperty(o, "value", { set: next });
};
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`another setter every time once: ${attempt(() => all(make(), make(), 7))}`, `another setter every time often: ${attempt(often)}`, `another setter every time new each time: ${attempt(fresh)}`, `another setter every time behind it: ${attempt(() => all(make(), make(), 9))}`);
}
let which = 0;
{
  const make: () => Held = () => [literal, withClosures, () => new Declared()][which++ % 3]!();
  const all = (o: Held, other: Held, i: number) => {
    const parts: unknown[] = [o.value];
    o.value = i;
    parts.push(o.inner);
    o.value = i + 1;
    parts.push(o.value);
    const before = o.value;
    o.value = before + 2;
    parts.push(before, (o.value += 3), o.value++ + ++o.value, (o.value ??= 4), (o.value ||= 5));
    ({ n: o.value } = { n: i });
    [o.value] = [o.value + 1];
    parts.push(o.value, (o.value = other.value = i), o.inner, o.log, other.inner);
    return parts.join();
  };
  const often = () => {
    const o = make();
    const other = make();
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      o.value = i & 15;
      sum += o.value;
      o.value += 2;
      sum += o.value++ + (o.value = other.value = i & 31) + o.inner + other.inner;
    }
    return `${sum} ${o.log} ${other.log}`;
  };
  const fresh = () => {
    let sum = 0;
    for (let i = 0; i < 3000; i++) {
      const o = make();
      o.value = i & 7;
      sum += (o.value += 1) + o.log;
    }
    return sum;
  };
  lines.push(`one of three in turns once: ${attempt(() => all(make(), make(), 7))}`, `one of three in turns often: ${attempt(often)}`, `one of three in turns new each time: ${attempt(fresh)}`, `one of three in turns behind it: ${attempt(() => all(make(), make(), 9))}`);
}

console.log(lines.join("\n"));
