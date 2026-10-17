// makes an object literal of a declared type with one key that the type does not have
interface Named {
  id: number;
  label: string;
}
const operations = 20;
const made: Named[] = [];
const keys: string[] = [];
for (let i = 0; i < operations; i++) {
  made.push({ id: 0, label: "" });
  keys.push("key" + (i % 4));
}
const make = (key: string, id: number): Named => ({ id, label: "x", [key]: id });
let total = 0;

kernel: {
  for (let i = 0; i < made.length; i++) made[i] = make(keys[i], i);
  total += made[7].id;
}

console.log(total);
