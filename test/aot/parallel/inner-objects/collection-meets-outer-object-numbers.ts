// The inner object is made first, with the cell of both; a string is put together before the outer object is filled, and that collects: the outer object has a header and no numbers yet.
interface Leaf { id: number }
interface Inner { count: number; leaf: Leaf; text: string }
interface Outer { inner: Inner; tag: number }
const into: Outer[] = [];
for (let i = 0; i < 3000; i++) into.push({ inner: { count: i, leaf: { id: i }, text: "t" + i }, tag: i });
let sum = 0;
for (const o of into) sum += o.inner.count + o.inner.leaf.id + o.inner.text.length + o.tag;
console.log(sum);
