// Frozen stores sloppy: compiled answers as plain.
const f = Object.freeze({ a: 1 }),
  l = Object.freeze([1]);
f.a = 2;
f.n = 1;
delete f.a;
l[0] = 9;
try {
  l.push(2);
} catch (e) {
  console.log(e.constructor.name);
}
console.log(JSON.stringify([f, l]));
