// A linked list whose nodes have different forms.
interface Link {
  value: number;
  label: string;
  live: boolean;
  next: Link | null;
}

const log: string[] = [];

class Node {
  value: number;
  label = "class";
  live = true;
  next: Link | null;
  constructor(value: number, next: Link | null) {
    this.value = value;
    this.next = next;
  }
}

class Backwards {
  next: Link | null;
  live = false;
  label = "backwards";
  value: number;
  constructor(value: number, next: Link | null) {
    this.next = next;
    this.value = value;
  }
}

class Lazy {
  label = "lazy";
  live = true;
  constructor(
    private v: number,
    private n: Link | null,
  ) {}
  get value(): number {
    log.push("get value");
    return this.v;
  }
  get next(): Link | null {
    log.push("get next");
    return this.n;
  }
  set next(link: Link | null) {
    log.push("set next");
    this.n = link;
  }
}

function sum(head: Link | null): number {
  let total = 0;
  for (let at = head; at !== null; at = at.next) total += at.value;
  return total;
}

function labels(head: Link | null): string {
  const out: string[] = [];
  for (let at = head; at !== null; at = at.next) out.push(at.label + (at.live ? "+" : "-"));
  return out.join();
}

function recursive(link: Link | null): number {
  return link === null ? 0 : link.value + recursive(link.next);
}

function reverse(head: Link | null): Link | null {
  let previous: Link | null = null;
  while (head !== null) {
    const next: Link | null = head.next;
    head.next = previous;
    previous = head;
    head = next;
  }
  return previous;
}

function build(): Link {
  const tail: Link = { value: 1, label: "literal", live: true, next: null };
  const flipped: Link = { next: tail, live: false, label: "flipped", value: 2 };
  const wide = { id: "w", value: 4, extra: [0], label: "wide", next: flipped, live: true, more: null };
  const node = new Node(8, wide);
  const backwards = new Backwards(16, node);
  const lazy = new Lazy(32, backwards);
  const inherited: Link = Object.assign(Object.create({ label: "inherited", live: true }), { value: 64, next: lazy });
  const proxied: Link = new Proxy({ value: 128, label: "proxied", live: false, next: inherited }, {});
  return new Node(256, proxied);
}

console.log("sum: " + sum(build()) + " [" + log.length + " accessor calls]");
log.length = 0;
console.log("recursive: " + recursive(build()));
console.log("labels: " + labels(build()));
log.length = 0;
const reversed = reverse(build());
console.log("reversed: " + labels(reversed) + " " + sum(reversed) + " [" + log.join() + "]");
log.length = 0;

let head: Link | null = null;
for (let i = 0; i < 2000; i++) head = new Node(1, head);
console.log("2000 honest nodes: " + sum(head));

let mixed: Link | null = null;
for (let i = 0; i < 2000; i++) {
  if (i === 500) mixed = { next: mixed, live: true, label: "odd", value: 1000 };
  else if (i === 1000) mixed = new Lazy(10000, mixed);
  else if (i === 1500) mixed = new Backwards(100000, mixed);
  else mixed = new Node(1, mixed);
}
console.log("three odd ones among 2000: " + sum(mixed) + " [" + log.length + "]");
log.length = 0;

const ring: Link = { value: 1, label: "ring", live: true, next: null };
ring.next = new Backwards(2, ring);
let steps = 0;
let around = 0;
for (let at: Link | null = ring; at !== null && steps < 7; at = at.next, steps++) around += at.value;
console.log("seven steps around a ring: " + around);

const json = JSON.stringify(build());
console.log("json: " + json);

export {};
