// The fields hold values of any type, and what is read is compared, tested and stored.
class Link {
  v: any;
  w: any;
  next: Link | null;
  constructor(v: any, w: any, next: Link | null) {
    this.v = v;
    this.w = w;
    this.next = next;
  }
}
const out: string[] = [];
function say(...values: any[]): void {
  out.push(values.map(value => (Array.isArray(value) ? value.map(String).join("/") : String(value))).join(" "));
}
function equal(head: Link, change: (x: any, r: number) => void): void {
  for (let r = 0; r < 4; r++) {
    let hits = 0;
    let last: any = "none";
    let n: Link | null = head;
    while (n !== null) {
      if (n.v === "x") hits++;
      if (n.w === "x") hits += 10;
      else last = n.w;
      n = n.next;
    }
    say("equal", r, hits, last);
    change(head, r);
  }
}
function typed(head: Link, change: (x: any, r: number) => void): void {
  for (let r = 0; r < 4; r++) {
    let hits = 0;
    let last = "none";
    for (let n: Link | null = head; n; n = n.next) {
      if (typeof n.v === "undefined") hits++;
      else last = typeof n.w;
    }
    say("typed", r, hits, last);
    change(head, r);
  }
}
function ordered(head: Link, change: (x: any, r: number) => void): void {
  for (let r = 0; r < 4; r++) {
    let hits = 0;
    let last: any = "none";
    for (let n: Link | null = head; n; n = n.next) {
      if (n.v < n.w) hits++;
      else last = n.w;
    }
    say("ordered", r, hits, last);
    change(head, r);
  }
}
function kept(head: Link, change: (x: any, r: number) => void): void {
  for (let r = 0; r < 4; r++) {
    const all: any[] = [];
    const box: any = {};
    for (let n: Link | null = head; n; n = n.next) {
      if (all.length < 2) all.push(n.v);
      else box.w = n.w;
      box.last = n.w ?? "nothing";
    }
    say("kept", r, all, box.w, box.last);
    change(head, r);
  }
}
const changes: ((x: any, r: number) => void)[] = [
  (x, r) => {
    if (r === 0) delete x.w;
    if (r === 1) delete x.v;
  },
  (x, r) => {
    if (r === 0) Object.defineProperty(x, "v", { get: () => "x", configurable: true });
    if (r === 1) Object.defineProperty(x, "w", { get: () => 7, configurable: true });
  },
  (x, r) => {
    if (r === 0) delete x.v;
    if (r === 1) x.v = "x";
    if (r === 2) Object.setPrototypeOf(x, { v: 1, w: 2 });
  },
  (x, r) => {
    if (r === 0) x.v = undefined;
    if (r === 1) x.w = () => 1;
    if (r === 2) Object.defineProperty(x, "v", { value: "x", writable: false });
  },
];
for (const change of changes) {
  for (const walk of [equal, typed, ordered, kept]) {
    const list: any = JSON.parse("0", () => new Link(1, "x", new Link("x", null, new Link(null, 1, null))));
    walk(list, change);
  }
}
console.log(out.join("\n"));
