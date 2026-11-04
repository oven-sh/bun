// `for (const [...[a, ...r]] of Object.entries(..))`: the rest comes first and is taken apart again. The second part of the pair read null.
function overEntries(n) {
  const held = Object.entries({ a: n, b: n + 1 });
  let t = "";
  for (const [...[a, ...r]] of held) { t += a + ":" + r[0] + ";"; }
  return t;
}
function overEntriesOfTexts(n) {
  let t = "";
  for (const [...[a, ...r]] of Object.entries({ a: "x" + n, b: [n], c: { n } })) t += a + ":" + JSON.stringify(r[0]) + "," + r.length + ";";
  return t;
}
function overAMap(n) {
  let t = "";
  for (const [...[a, ...r]] of new Map([["a", n], ["b", n + 1]])) t += a + ":" + r[0] + ";";
  return t;
}
function overEntriesOfAMap(n) {
  let t = "";
  for (const [...[a, ...r]] of new Map([["a", n]]).entries()) t += a + ":" + r[0] + ";";
  return t;
}
function overEntriesOfAList(n) {
  let t = "";
  for (const [...[a, ...r]] of [n, n + 1].entries()) t += a + ":" + r[0] + ";";
  return t;
}
function overEntriesOfASet(n) {
  let t = "";
  for (const [...[a, ...r]] of new Set([n]).entries()) t += a + ":" + r[0] + ";";
  return t;
}
function secondAlone(n) {
  let t = "";
  for (const [...[, b]] of Object.entries({ a: n })) t += b + ";";
  return t;
}
function restInRest(n) {
  let t = "";
  for (const [...[...all]] of Object.entries({ a: n })) t += all.join() + "," + all.length + ";";
  return t;
}
function onePair(n) {
  const [...[a, ...r]] = Object.entries({ a: n })[0];
  return a + ":" + (r[0] + 1);
}
function inAParameter(n) {
  return Object.entries({ a: n, b: n + 1 }).map(([...[a, ...r]]) => a + ":" + r[0]).join(";");
}
console.log(overEntries(1), overEntries(2));
console.log(overEntriesOfTexts(1), overAMap(1), overEntriesOfAMap(2), overEntriesOfAList(3), overEntriesOfASet(4));
console.log(secondAlone(5), restInRest(6), onePair(7), inAParameter(8));
