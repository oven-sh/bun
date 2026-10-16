// sets the value of a string that a Map holds
const operations = 100;
const keys: string[] = [];
const ages = new Map<string, number>();
for (let i = 0; i < operations; i++) {
  keys.push("key" + i);
  ages.set("key" + i, i);
}
let total = 0;

kernel: {
  for (let i = 0; i < keys.length; i++) ages.set(keys[i], i);
  total += ages.size;
}

console.log(total);
