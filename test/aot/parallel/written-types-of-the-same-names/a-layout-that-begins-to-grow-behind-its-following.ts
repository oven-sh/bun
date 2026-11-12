interface Leaf { nested: number; next: null }
interface Nest<T> { nested: T; next: Nest<Nest<T>> | null }
interface Wrap { inner: Nest<number> }
interface Holder { later: Wrap; zlast: Leaf }

function load(text: string): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const holder: Holder = JSON.parse(text);
  return work + holder.zlast.nested + holder.later.inner.nested;
}
console.log(load('{"later":{"inner":{"nested":4,"next":null}},"zlast":{"nested":2,"next":null}}'));
