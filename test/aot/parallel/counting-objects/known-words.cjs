// STATISTIC: CountersKeptAsDictionaries >= 1
// The words are known, and each loop reads and stores under one of them: no word is a field of the literal.
function count(list) {
  const r = {};
  for (const word of list) r[word] = (r[word] ?? 0) + 1;
  return r;
}
function tested(list) {
  const r = {};
  for (const word of list) {
    if (r[word]) r[word]++;
    else r[word] = 1;
  }
  return r;
}
function asked() {
  const r = {};
  for (const word of ["a", "b", "a", "c"]) {
    if (word in r) r[word] += 2;
    else r[word] = 0.5;
  }
  return r;
}
function grouped() {
  const r = {};
  for (const word of ["a", "b", "a", "c"]) (r[word] ??= []).push(word + r.a?.length);
  return r;
}
function seen() {
  const r = {};
  let made = "";
  for (const word of ["a", "b", "a", "c"]) {
    if (!r[word]) made += word;
    r[word] = true;
  }
  return made + Object.keys(r);
}
// This one is stored into under a written name as well.
function named() {
  const r = {};
  r.a = 10;
  for (const word of ["a", "b", "a"]) r[word] = (r[word] ?? 0) - 1;
  return r;
}
const words = ["a", "b", "a", "c", "b", "a"], others = ["x", "toString", "x"];
for (let k = 0; k < 3; k++) {
  const r = count(words);
  console.log(r.a, r.b + r.c, r.d, JSON.stringify(r), Object.keys(count(words)).join());
  delete r.a;
  r.z = k;
  for (const key in r) console.log(key, r[key]);
  console.log(JSON.stringify(tested(others)), JSON.stringify(asked()), JSON.stringify(grouped()), seen(), JSON.stringify(named()));
}
