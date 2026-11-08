function* tail() { yield "t1"; yield "t2"; }
function* source() {
  try { yield "a"; yield "b"; }
  finally { for (const piece of tail()) yield piece; }
}
function consume(stopAt) {
  const seen = [];
  for (const item of source()) { seen.push(item); if (item === stopAt) break; }
  return seen.join();
}
console.log(consume("a"));
console.log(consume("t1"));
console.log(consume("none"));
