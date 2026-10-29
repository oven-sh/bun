// Alone: what stands in for a member depends on what else the executable holds
// A member of Bun that the program never names is not compiled. What stands in for it shows as the member does: its kind, name and length, and one object under two names.
const face = value =>
  [Bun.inspect(value), JSON.stringify(value.name), value.length, Object.hasOwn(value, "prototype")].join(" | ");
for (const key of Reflect.ownKeys(Bun))
  if (typeof Bun[key] === "function") console.log(String(key) + ": " + face(Bun[key]));
const names = ["sql", "postgres", "SQL"];
console.log(Bun[names[0]] === Bun[names[1]], Bun[names[0]] === Bun[names[2]]);
