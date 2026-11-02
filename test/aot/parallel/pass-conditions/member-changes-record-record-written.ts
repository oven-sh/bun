// JSON.stringify of a record whose member has a toJSON that deletes the field behind it, stores a text there, or adds a field.
class Inner {
  n: number;
  owner: Outer | null = null;
  constructor(n: number) {
    this.n = n;
  }
  toJSON(): unknown {
    const held = this.owner as { last?: unknown; extra?: number } | null;
    if (held) {
      if (this.n % 4 === 1) delete held.last;
      if (this.n % 4 === 2) held.last = "text";
      if (this.n % 4 === 3) held.extra = 1;
    }
    return { n: this.n };
  }
}
class Outer {
  first: number;
  inner: Inner;
  last: number;
  constructor(at: number) {
    this.first = at;
    this.inner = new Inner(at);
    this.last = at * 2;
  }
}
function write(it: Outer): string {
  return JSON.stringify(it);
}
for (let at = 0; at < 8; at++) {
  const it = new Outer(at);
  if (at > 3) it.inner.owner = it;
  console.log(write(it), Object.keys(it).join("+"));
}
