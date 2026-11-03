const other = { color: 1.5 };
const more = { color: -0, next: NaN };
const nested = { inner: { color: 2 ** 40 } };
const first = { kind: 1.5, first: 1 };
const second = { kind: 2.5, second: 2 };
console.log(first.kind + first.first, second.kind + second.second, { copied: 0.25 }.copied);
console.log(other.color, more.color, more.next, nested.inner.color, { side: 0.5 }.side, { flags: 1e300 }.flags, { only: 7.5 }.only, { level: 2.5 }.level, { one: 5.5 }.one);
export {};
