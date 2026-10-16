// adds strings to an empty Set
const operations = 100;
const keys: string[] = [];
for (let i = 0; i < operations; i++) keys.push("key" + i);
let total = 0;

kernel: {
  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i++) seen.add(keys[i]);
  total += seen.size;
}

console.log(total);
