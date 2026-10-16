// asks a Set for a string that it holds
const operations = 100;
const keys: string[] = [];
const seen = new Set<string>();
for (let i = 0; i < operations; i++) {
  keys.push("key" + i);
  seen.add("key" + i);
}
let total = 0;

kernel: {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (seen.has(keys[i])) count += 1;
  total += count;
}

console.log(total);
