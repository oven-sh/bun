// looks up a string that a Map holds
const operations = 100;
const keys: string[] = [];
const ages = new Map<string, number>();
for (let i = 0; i < operations; i++) {
  keys.push("key" + i);
  ages.set("key" + i, i);
}
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += ages.get(keys[i])!;
  total += sum;
}

console.log(total);
