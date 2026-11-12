const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
for (let turn = 0; turn < 300; turn++) { said.length = 0;
  const list = ["a", "b", "c", "d"];
  const held = list.entries(); for (const [i, x] of held) { said.push(i, x); if (i === 1) break; } said.push(held.next().value, [...held]);
  const keys = list.keys(); said.push(keys.next().value); for (const i of keys) said.push(i); said.push(keys.next().done);
  const values = list.values(); for (const x of values) { said.push(x); said.push(values.next().value); }
  said.push(Object.prototype.toString.call(list.entries()), typeof list.entries().next, list.entries()[Symbol.iterator]() instanceof Object);
}
console.log(said.map(show).join(" "));
