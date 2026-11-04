// One loop runs over one object again and again. Between two runs the object loses, regains and gains a name, and the object above it gains one and hides one: no run lists what an earlier run has found.
function walk(o) {
  let text = "";
  for (const k in o) text += k + "=" + o[k] + " ";
  return text;
}
function deed() {
  const above = { up: 1 };
  const o = Object.create(above);
  o.a = 1; o.b = 2; o.c = 3;
  const twin = Object.create(above);
  twin.a = 4; twin.b = 5; twin.c = 6;
  const seen = [walk(o), walk(o)];
  delete o.b; seen.push(walk(o));
  o.b = 7; seen.push(walk(o));
  o.d = 8; seen.push(walk(o));
  above.late = 9; seen.push(walk(o), walk(twin));
  Object.defineProperty(above, "up", { enumerable: false }); seen.push(walk(o), walk(twin));
  return seen.join("| ");
}
console.log(deed());
for (let round = 0; round < 3; round++) console.log(deed());
