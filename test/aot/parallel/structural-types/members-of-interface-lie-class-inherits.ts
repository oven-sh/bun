// Members of an interface lie behind what each class inherits.
interface HasId {
  id: number;
  tag: string;
  ratio: number;
  done: boolean;
  next: HasId;
  late?: number;
}

class B1 {
  a0: number = 1;
  sum1(): number {
    return this.a0;
  }
}
class B2 extends B1 {
  a1: number = 2;
  a2: string = "x";
  sum2(): number {
    return this.a0 + this.a1;
  }
}
class B3 extends B2 {
  a3: number = 3;
  a4: number = 4;
  a5: string = "y";
  sum3(): number {
    return this.a0 + this.a1 + this.a3 + this.a4;
  }
}
class B4 extends B3 {
  a6: number = 0.5;
  a7: number = 6;
  sum4(): number {
    return this.a3 + this.a7 + this.a6;
  }
}

class C0 implements HasId {
  id: number;
  tag: string;
  ratio: number;
  done: boolean;
  next: HasId;
  late?: number;
  constructor(k: number) {
    this.id = k;
    this.tag = "c0";
    this.ratio = k + 0.25;
    this.done = false;
    this.next = this;
  }
}
class C1 extends B1 implements HasId {
  id: number;
  tag: string;
  ratio: number;
  done: boolean;
  next: HasId;
  late?: number;
  constructor(k: number) {
    super();
    this.id = k;
    this.tag = "c1";
    this.ratio = k + 0.25;
    this.done = true;
    this.next = this;
  }
}
class C2 extends B2 implements HasId {
  id: number;
  tag: string;
  ratio: number;
  done: boolean;
  next: HasId;
  late?: number;
  constructor(k: number) {
    super();
    this.id = k;
    this.tag = "c2";
    this.ratio = k + 0.25;
    this.done = false;
    this.next = this;
  }
}
class C3 extends B3 implements HasId {
  id: number;
  tag: string;
  ratio: number;
  done: boolean;
  next: HasId;
  late?: number;
  constructor(k: number) {
    super();
    this.id = k;
    this.tag = "c3";
    this.ratio = k + 0.25;
    this.done = true;
    this.next = this;
  }
}
class C4 extends B4 implements HasId {
  id: number;
  tag: string;
  ratio: number;
  done: boolean;
  next: HasId;
  late?: number;
  constructor(k: number) {
    super();
    this.id = k;
    this.tag = "c4";
    this.ratio = k + 0.25;
    this.done = false;
    this.next = this;
  }
}
class D3 extends B3 implements HasId {
  tag: string;
  b0: number = 9;
  done: boolean;
  next: HasId;
  ratio: number;
  id: number;
  late?: number;
  constructor(k: number) {
    super();
    this.tag = "d3";
    this.done = true;
    this.next = this;
    this.ratio = k + 0.25;
    this.id = k;
  }
}

function make(kind: number, k: number): HasId {
  switch (kind) {
    case 0:
      return new C0(k);
    case 1:
      return new C1(k);
    case 2:
      return new C2(k);
    case 3:
      return new C3(k);
    case 4:
      return new C4(k);
    default:
      return new D3(k);
  }
}

function ring(kinds: number): HasId {
  const first = make(0, 10);
  let last = first;
  for (let k = 1; k < kinds; ++k) {
    const item = make(k, 10 + k);
    last.next = item;
    last = item;
  }
  last.next = first;
  return first;
}

function inherited(list: B1[]): number {
  let r = 0;
  for (const b of list) {
    r += b.sum1();
    if (b instanceof B2) r += b.sum2();
    if (b instanceof B3) r += b.sum3();
    if (b instanceof B4) r += b.sum4();
  }
  return r;
}

function read(start: HasId, n: number): string {
  let ids = 0,
    ratios = 0,
    finished = 0,
    tags = "",
    p = start;
  for (let i = 0; i < n; ++i) {
    ids += p.id;
    ratios += p.ratio;
    if (p.done) ++finished;
    tags += p.tag;
    p = p.next;
  }
  return ids + " " + ratios + " " + finished + " " + tags;
}

function store(start: HasId, n: number): void {
  let p = start;
  for (let i = 0; i < n; ++i) {
    p.id = p.id + 1;
    p.ratio = p.ratio * 2;
    p.done = !p.done;
    p.tag = p.tag + i;
    p = p.next;
  }
}

function addLate(start: HasId, n: number): string {
  let seen = "",
    p = start;
  for (let i = 0; i < n; ++i) {
    seen += p.late === undefined ? "-" : p.late;
    p.late = i;
    p = p.next;
  }
  return seen;
}

function keys(start: HasId, n: number): string {
  let out = "",
    p = start;
  for (let i = 0; i < n; ++i) {
    out += Object.keys(p).join() + ";";
    p = p.next;
  }
  return out;
}

for (const size of [1, 2, 4, 6]) {
  const start = ring(size);
  console.log(size, read(start, 7));
  store(start, 7);
  console.log(size, read(start, 7));
  console.log(size, addLate(start, 9));
  console.log(size, keys(start, size));
}

const odd = ring(6);
delete (odd.next as { late?: number }).late;
delete (odd.next.next as { id?: number }).id;
Object.freeze(odd.next.next.next);
(odd.next.next.next.next as unknown as { more: number }).more = 5;
Object.defineProperty(odd.next.next.next.next.next, "id", { get: () => 77, set() {}, configurable: true, enumerable: true });
console.log(read(odd, 6));
try {
  store(odd, 6);
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(read(odd, 6));
try {
  console.log(addLate(odd, 12));
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(keys(odd, 6));
console.log(inherited([new B1(), new B2(), new B3(), new B4(), new C1(1), new C2(2), new C3(3), new C4(4), new D3(5)]));
