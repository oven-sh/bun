// The object that is enumerated has a `hasOwnProperty` of its own, and a local is named `Object`: what is called goes by binding, never by a name.
function walk(o) {
  let text = "";
  for (const k in o) text += k + (o.hasOwnProperty(k) ? "+" : "-") + " ";
  return text;
}
function local(o) {
  const Object = { hasOwn: (object, key) => key === "b" };
  let text = "";
  for (const k in o) text += k + (Object.hasOwn(o, k) ? "+" : "-") + " ";
  return text;
}
function deed() {
  const o = { a: 1, b: 2, hasOwnProperty(k) { return k === "a"; } };
  return walk(o) + "| " + local({ a: 1, b: 2 });
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(walk({ a: i, b: 2 }), "#", deed());
console.log(walk(Object.assign(Object.create({ hasOwnProperty: () => false }), { a: 1 })));
