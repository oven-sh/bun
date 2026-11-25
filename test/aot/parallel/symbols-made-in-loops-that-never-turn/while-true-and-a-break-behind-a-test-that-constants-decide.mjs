let K;
while (true) {
  K = Symbol("k");
  if (1 !== 2) break;
}
const holder = {};
holder[K] = 1;
const listed = Object.getOwnPropertySymbols(holder);
console.log(listed.length, listed[0] === K, holder[K], holder[listed[0]], String(K));
