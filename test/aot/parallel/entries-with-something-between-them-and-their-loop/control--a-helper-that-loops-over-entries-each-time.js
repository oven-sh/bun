function each(list, source, visit) {
  for (const [key, value] of list(source)) visit(key, value);
}
function tally(source, plain) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const parts = [];
  each(Object.entries, source, (key, value) => { parts.push(key + "=" + value); });
  each(Object.entries, source, (key, value) => { parts.push(key + ":" + value); });
  each(Object.entries, source, (key, value) => { parts.push(key + (plain ? "~" : "~") + value); });
  return parts.join(" ") + " " + work;
}
let a = "", b = "";
for (let round = 0; round < 300; round++) {
  a = tally({ x: round, y: 2 }, true);
  b = tally({ x: round, y: 2 }, false);
}
console.log(a);
console.log(b);
