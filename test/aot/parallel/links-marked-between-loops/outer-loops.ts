// Outer loops of every form, and two of them around one another.
class Link {
  v: string;
  w: string;
  next: Link | null;
  constructor(v: string, w: string, next: Link | null) {
    this.v = v;
    this.w = w;
    this.next = next;
  }
}
const out: string[] = [];
function mark(x: any, r: number): void {
  if (r === 0) delete x.w;
  if (r === 1) Object.defineProperty(x, "w", { get: () => "got" });
}
function whileLoop(head: Link): void {
  let r = -1;
  while (++r < 3) {
    let last: unknown = "none";
    for (let n: Link | null = head; n; n = n.next) {
      if (n.v === "a") last = n.w;
    }
    out.push(String(last));
    mark(head, r);
  }
}
function forOf(head: Link): void {
  for (const r of [0, 1, 2]) {
    let last: unknown = "none";
    for (let n: Link | null = head; n; n = n.next) {
      if (n.v === "a") last = n.w;
    }
    out.push(String(last));
    mark(head, r);
  }
}
function doWhile(head: Link): void {
  let r = 0;
  do {
    let last: unknown = "none";
    let n: Link | null = head;
    do {
      if (n!.v === "a") last = n!.w;
      n = n!.next;
    } while (n);
    out.push(String(last));
    mark(head, r);
  } while (++r < 3);
}
function threeDeep(head: Link): void {
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      let last: unknown = "none";
      for (let n: Link | null = head; n; n = n.next) {
        if (n.v === "a") last = n.w;
      }
      out.push(String(last));
    }
    mark(head, a);
  }
}
let shared: Link | null = null;
function ofVariable(): void {
  for (let r = 0; r < 3; r++) {
    let last: unknown = "none";
    for (let n: Link | null = shared; n; n = n.next) {
      if (n.v === "a") last = n.w;
    }
    out.push(String(last));
    mark(shared, r);
  }
}
function* generator(head: Link): Generator<string> {
  for (let r = 0; r < 3; r++) {
    let last: unknown = "none";
    for (let n: Link | null = head; n; n = n.next) {
      if (n.v === "a") last = n.w;
    }
    yield String(last);
  }
}
async function asynchronous(head: Link): Promise<void> {
  for (let r = 0; r < 3; r++) {
    let last: unknown = "none";
    for (let n: Link | null = head; n; n = n.next) {
      if (n.v === "a") last = n.w;
    }
    out.push(String(last));
    await null;
    mark(head, r);
  }
}
function list(): any {
  return JSON.parse("0", () => new Link("a", "b", new Link("c", "d", null)));
}
whileLoop(list());
forOf(list());
doWhile(list());
threeDeep(list());
shared = list();
ofVariable();
const suspended = list();
let r = 0;
for (const value of generator(suspended)) {
  out.push(value);
  mark(suspended, r++);
}
asynchronous(list()).then(() => console.log(out.join(" ")));
