// A loop reads a field under a condition that fails while the field is not defined yet.
class Inner {
  constructor(public n: number) {}
}

class PrivateList {
  #early: number = this.sum(false, 3);
  #list: number[] = [2, 3, 4];
  #late: number = this.sum(true, 3);
  sum(flag: boolean, n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) if (flag) s += this.#list[0];
    return s;
  }
  results() {
    return [this.#early, this.#late];
  }
}

class PrivateObject {
  #early: number = this.sum(false, 3);
  #inner: Inner = new Inner(5);
  #late: number = this.sum(true, 3);
  sum(flag: boolean, n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) if (flag) s += this.#inner.n;
    return s;
  }
  results() {
    return [this.#early, this.#late];
  }
}

class PublicMap {
  early: number = this.sum(false, 3);
  map: Map<number, number> = new Map([[1, 2]]);
  late: number = this.sum(true, 3);
  sum(flag: boolean, n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) if (flag) s += this.map.size;
    return s;
  }
}

class Base {
  early: number;
  constructor() {
    this.early = this.sum(false, 4);
  }
  sum(_flag: boolean, _n: number): number {
    return 0;
  }
}

class Derived extends Base {
  bytes: Uint8Array = new Uint8Array([7, 8]);
  sum(flag: boolean, n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) if (flag) s += this.bytes[1];
    return s;
  }
}

class StoredInLoop {
  s = 0;
  declare inner: Inner;
  constructor(n: number, at: number) {
    for (let i = 0; i < n; i++) {
      if (i > at) this.s += this.inner.n;
      if (i === at) this.inner = new Inner(i + 1);
    }
  }
}

let last: ThrowsBeforeStore | null = null;
class ThrowsBeforeStore {
  declare inner: Inner;
  constructor(fails: boolean) {
    last = this;
    if (fails) throw new RangeError("fails");
    this.inner = new Inner(6);
  }
}

function sumOfInner(o: ThrowsBeforeStore, flag: boolean, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) if (flag) s += o.inner.n;
  return s;
}

for (let r = 0; r < 4; r++) {
  const list = new PrivateList();
  const object = new PrivateObject();
  const map = new PublicMap();
  const derived = new Derived();
  console.log(list.results().join(), list.sum(true, 2), object.results().join(), object.sum(true, 2));
  console.log(map.early, map.late, map.sum(true, 2), derived.early, derived.sum(true, 4));
  console.log(new StoredInLoop(6, 2).s, new StoredInLoop(6, 7).s, sumOfInner(new ThrowsBeforeStore(false), true, 3));
  try {
    new ThrowsBeforeStore(true);
  } catch {}
  console.log(sumOfInner(last!, false, 3));
  try {
    console.log(sumOfInner(last!, true, 3));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
