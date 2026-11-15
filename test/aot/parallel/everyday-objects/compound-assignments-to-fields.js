// Compound assignments to fields and elements, with effects counted
function update(n) {
  let reads = 0;
  const item = { a: n, b: null, c: 0, list: [n, n + 1] };
  const get = () => (reads++, item);
  get().a **= 2;
  get().b ??= n + 5;
  get().c ||= n - 1;
  get().a &&= get().a + 1;
  get().list[get().list.length - 1] += get().b;
  get().a >>>= 1;
  return JSON.stringify(item) + reads;
}
console.log(update(3));
console.log(update(10));
console.log(update(1));
