// copies a record that has an undeclared property into a literal of its own type
type Settings = { id: number; label: string };
const operations = 100;
const makeSettings = (id: number): Settings => {
  const settings: Settings = { id, label: "x" };
  (settings as any).tag = id;
  return settings;
};
const all = [makeSettings(0)];
for (let i = 1; i < operations; i++) all.push(makeSettings(i));
const copies: Settings[] = [];

kernel: {
  for (let i = 0; i < all.length; i++) copies.push({ ...all[i] });
}

console.log(Object.keys(copies[operations - 1]).join());
