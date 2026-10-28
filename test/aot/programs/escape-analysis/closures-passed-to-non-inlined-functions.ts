// Closures that must stay heap-allocated because they are passed to large or recursive functions that are not inlined.
const kept: ((x: number) => number)[] = [];
let noise = "";
function pad(k: number): void { for (let i = 0; i < 3; i++) { noise += (k + i) % 10; if (noise.length > 40) noise = noise.slice(20); } }
function keeps(f: (x: number) => number, depth: number): number {
  pad(depth); pad(depth + 1);
  let h = depth * 31 + 7;
  h = ((h ^ (h >> 1)) + 11) % 100003; if (h % 97 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 18) % 100003; if (h % 99 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 25) % 100003; if (h % 101 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 32) % 100003; if (h % 103 === 0) pad(h);
  h = ((h ^ (h >> 5)) + 39) % 100003; if (h % 105 === 0) pad(h);
  h = ((h ^ (h >> 1)) + 46) % 100003; if (h % 107 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 53) % 100003; if (h % 109 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 60) % 100003; if (h % 111 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 67) % 100003; if (h % 113 === 0) pad(h);
  h = ((h ^ (h >> 5)) + 74) % 100003; if (h % 115 === 0) pad(h);
  h = ((h ^ (h >> 1)) + 81) % 100003; if (h % 117 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 88) % 100003; if (h % 119 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 95) % 100003; if (h % 121 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 102) % 100003; if (h % 123 === 0) pad(h);
  noise += h % 10;
  if (depth > 2) { kept.push(f); return f(1); }
  if (depth === 1) return keeps(f, depth + 2) + 1;
  pad(depth + 2);
  return keeps(f, depth + 1) + keeps(f, depth + 3);
}
function returns(f: (x: number) => number, depth: number): (x: number) => number {
  pad(depth); pad(depth + 1);
  let h = depth * 31 + 7;
  h = ((h ^ (h >> 1)) + 11) % 100003; if (h % 97 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 18) % 100003; if (h % 99 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 25) % 100003; if (h % 101 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 32) % 100003; if (h % 103 === 0) pad(h);
  h = ((h ^ (h >> 5)) + 39) % 100003; if (h % 105 === 0) pad(h);
  h = ((h ^ (h >> 1)) + 46) % 100003; if (h % 107 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 53) % 100003; if (h % 109 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 60) % 100003; if (h % 111 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 67) % 100003; if (h % 113 === 0) pad(h);
  h = ((h ^ (h >> 5)) + 74) % 100003; if (h % 115 === 0) pad(h);
  h = ((h ^ (h >> 1)) + 81) % 100003; if (h % 117 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 88) % 100003; if (h % 119 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 95) % 100003; if (h % 121 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 102) % 100003; if (h % 123 === 0) pad(h);
  noise += h % 10;
  if (depth > 2) { f(1); return f; }
  if (depth === 1) return returns(f, depth + 2);
  pad(depth + 2);
  returns(f, depth + 3);
  return returns(f, depth + 1);
}
function captures(f: (x: number) => number, depth: number): () => number {
  pad(depth); pad(depth + 1);
  let h = depth * 31 + 7;
  h = ((h ^ (h >> 1)) + 11) % 100003; if (h % 97 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 18) % 100003; if (h % 99 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 25) % 100003; if (h % 101 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 32) % 100003; if (h % 103 === 0) pad(h);
  h = ((h ^ (h >> 5)) + 39) % 100003; if (h % 105 === 0) pad(h);
  h = ((h ^ (h >> 1)) + 46) % 100003; if (h % 107 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 53) % 100003; if (h % 109 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 60) % 100003; if (h % 111 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 67) % 100003; if (h % 113 === 0) pad(h);
  h = ((h ^ (h >> 5)) + 74) % 100003; if (h % 115 === 0) pad(h);
  h = ((h ^ (h >> 1)) + 81) % 100003; if (h % 117 === 0) pad(h);
  h = ((h ^ (h >> 2)) + 88) % 100003; if (h % 119 === 0) pad(h);
  h = ((h ^ (h >> 3)) + 95) % 100003; if (h % 121 === 0) pad(h);
  h = ((h ^ (h >> 4)) + 102) % 100003; if (h % 123 === 0) pad(h);
  noise += h % 10;
  if (depth > 2) return () => f(2);
  if (depth === 1) return captures(f, depth + 2);
  pad(depth + 2);
  captures(f, depth + 3)();
  return captures(f, depth + 1);
}
function deep(k: number): number { return k <= 0 ? 0 : 1 + deep(k - 1) + (k & 1); }
function handedToKeeper(n: number): number { //! heap
  let total = n;
  const f = (x: number): number => { total += x; return total; }; //! heap
  return keeps(f, 0) + keeps(f, 1);
}
function handedToReturner(n: number): (x: number) => number { //! heap
  let total = n;
  const f = (x: number): number => { total += x; return total; }; //! heap
  returns(f, 1);
  return returns(f, 0);
}
function handedToCapturer(n: number): () => number { //! heap
  let total = n;
  const f = (x: number): number => { total += x; return total; }; //! heap
  captures(f, 1);
  return captures(f, 0);
}
let out = "";
for (let i = 0; i < 120; i++) {
  const a = handedToKeeper(i), b = handedToReturner(i), c = handedToCapturer(i);
  const d = deep(20 + (i % 5));
  const e = b(5) + c() + d;
  if (i % 30 === 0) out += a + "|" + e + "\n";
}
let later = 0;
for (let i = 0; i < kept.length; i++) later += kept[i](1) + deep(6);
console.log(out + later + ":" + noise.length);
