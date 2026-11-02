type Item = { flag?: boolean };
const attempt = (f: () => unknown): void => {
  try {
    console.log(JSON.stringify(f()) ?? "undefined");
  } catch (e) {
    console.log(String(e).split(" (bun")[0]);
  }
};
{
  class Holder {
    flag?: boolean;
    constructor(list: Item[]) {
      this.flag = list.some(item => item.flag === true) || undefined;
    }
  }
  attempt(() => new Holder([]));
  attempt(() => new Holder([{ flag: false }]));
  attempt(() => new Holder([{ flag: true }]));
}
{
  class Holder {
    flag?: boolean;
    constructor(list: Item[]) {
      this.flag = list.some(item => item.flag === true) || undefined;
    }
  }
  console.log(JSON.stringify(new Holder([])), JSON.stringify(new Holder([{ flag: true }])));
}
{
  function any(list: Item[]) {
    const found = list.some(item => item.flag === true) || undefined;
    return found;
  }
  attempt(() => any([]));
  attempt(() => any([{ flag: true }]));
}
{
  function size(sizes: Map<string, number>, name: string) {
    const found = sizes.get(name) ?? null;
    return found;
  }
  attempt(() => size(new Map(), "a"));
  attempt(() => size(new Map([["a", 1]]), "a"));
}
{
  function name(list: Item[]) {
    const found = list.some(item => item.flag === true) && "found";
    return found;
  }
  attempt(() => name([]));
  attempt(() => name([{ flag: true }]));
}
{
  function any(list: Item[]) {
    try {
      const found = list.some(item => item.flag === true) || undefined;
      return found;
    } finally {
      list.length = 0;
    }
  }
  attempt(() => any([]));
  attempt(() => any([{ flag: true }]));
}
{
  class Inner {
    id: number;
    constructor(id: number) {
      this.id = id;
    }
  }
  interface Outer {
    inner: Inner | null;
  }
  const outside: Inner = JSON.parse('{"id":5}');
  function read(p: Outer) {
    try {
      return p.inner?.id;
    } finally {
      p.inner = null;
    }
  }
  attempt(() => read({ inner: null }));
  attempt(() => read({ inner: new Inner(1) }));
  attempt(() => read({ inner: outside }));
}
{
  interface Pair {
    a: number;
    b: number;
  }
  attempt(() => {
    const heir: Pair = Object.assign(Object.create({ b: 2 }), { a: 1 });
    const copy: Pair = { ...heir };
    return copy.a + " " + copy.b;
  });
}
{
  function first(ask: () => boolean) {
    const found = ask() || undefined;
    return found;
  }
  const lies: any = () => "text";
  attempt(() => first(() => false));
  attempt(() => first(() => true));
  attempt(() => first(lies));
}
