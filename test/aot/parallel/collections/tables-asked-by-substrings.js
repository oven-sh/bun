// Maps and sets are asked by substrings of every length, of narrow and of wide strings, before and after their tables have grown.
const digest = text => { let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return h; };
const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJéÿß0123456789_$";
let seed = 12345;
const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff);
function word(length, isWide) {
  let text = "";
  for (let i = 0; i < length; i++) text += alphabet[next() % alphabet.length];
  return isWide ? text.slice(0, -1) + "Ж" : text;
}
function ask(numberOfKeys, isWideBase) {
  const keys = [];
  for (let i = 0; i < numberOfKeys; i++) keys.push(word(1 + (i % 19), i % 11 === 10));
  const tail = isWideBase ? "中" : ";";
  const source = keys.join(";") + tail;
  const map = new Map(), set = new Set();
  const starts = [];
  let at = 0;
  for (let i = 0; i < keys.length; i++) {
    starts.push(at);
    at += keys[i].length + 1;
  }
  let found = 0, absent = 0, sum = 0;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < keys.length; i++) {
      const piece = source.substring(starts[i], starts[i] + keys[i].length);
      const known = map.get(piece);
      if (known === undefined) {
        absent++;
        if (i % 3 !== round) map.set(keys[i], i);
        else if (i % 2) map.set(piece, i);
      } else {
        found++;
        sum = (sum + known) | 0;
      }
      if (set.has(source.substring(starts[i], starts[i] + keys[i].length))) sum = (sum + 7) | 0;
      else set.add(source.substring(starts[i], starts[i] + keys[i].length));
      if (map.get(source.substring(starts[i], starts[i] + keys[i].length - 1)) !== undefined) sum = (sum + 3) | 0;
      if (map.get(source.substring(starts[i] + 1, starts[i] + keys[i].length)) !== undefined) sum = (sum + 5) | 0;
      if (map.get(source.substring(starts[i], starts[i] + keys[i].length + 1)) !== undefined) sum = (sum + 11) | 0;
    }
    for (let i = round; i < keys.length; i += 5) map.delete(source.substring(starts[i], starts[i] + keys[i].length));
  }
  const order = digest([...map.keys()].join("|")) ^ digest([...set].join("|"));
  console.log(numberOfKeys, isWideBase, found, absent, sum, map.size, set.size, order);
}
for (const count of [1, 3, 4, 5, 8, 9, 16, 33, 63, 64, 65, 127, 200, 254, 255, 256, 700, 5000]) {
  ask(count, false);
  ask(count, true);
}

// Keys of every kind, in tables that grow past the first sizes, with entries deleted on the way.
const objects = Array.from({ length: 400 }, (_, i) => ({ i }));
const mixed = new Map();
const keyAt = i => i % 7 === 0 ? i : i % 7 === 1 ? i + 0.5 : i % 7 === 2 ? "k" + i : i % 7 === 3 ? objects[i % 400] : i % 7 === 4 ? BigInt(i) : i % 7 === 5 ? -i : "Ж" + i;
for (let i = 0; i < 4000; i++) {
  mixed.set(keyAt(i), i);
  if (i % 3 === 0) mixed.delete(keyAt(i >> 1));
}
let right = 0, missing = 0;
for (let i = 0; i < 4000; i++) {
  const value = mixed.get(keyAt(i));
  if (value === undefined) missing++;
  else right = (right + value) | 0;
}
console.log(mixed.size, right, missing, digest([...mixed.values()].join()));
mixed.set(NaN, 1).set(-0, 2).set(undefined, 3).set(null, 4).set(true, 5);
console.log(mixed.get(NaN), mixed.get(0), mixed.get(undefined), mixed.get(null), mixed.get(true), mixed.get(false));
