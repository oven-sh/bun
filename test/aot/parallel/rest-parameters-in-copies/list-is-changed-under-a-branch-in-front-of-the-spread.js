function inner(a, b, c) { return [a, b, c, arguments.length].join(); }
function sometimes(flag, ...xs) {
  if (flag) xs.push("pushed");
  return inner(...xs);
}
function inLoop(turns, ...xs) {
  for (let i = 0; i < turns; i++) xs.push(i);
  return inner(...xs);
}
for (let i = 0; i < 4; i++) console.log(sometimes(i & 1, i, 2), inLoop(i & 1, i));
