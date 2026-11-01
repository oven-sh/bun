const other = { color: "none" };
const more = { color: "some", next: "more" };
const nested = { inner: { color: "inside" } };
const first = { kind: "first", first: "1" };
const second = { kind: "second", second: "2" };
console.log(first.kind + first.first, second.kind + second.second, { copied: "copy" }.copied);
console.log(other.color, more.color + more.next, nested.inner.color, { side: "left" }.side, { flags: "rw" }.flags, { only: "one" }.only, { level: "high" }.level, { one: "1" }.one);
export {};
