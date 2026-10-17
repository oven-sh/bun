// reads a property under a key that is a rope of four thousand characters
const operations = 20;
const prefix = "x".repeat(4000);
const suffixes = ["-a", "-b", "-c", "-d"];
const table: Record<string, number> = {};
for (let i = 0; i < suffixes.length; i++) table[prefix + suffixes[i]] = i;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += table[prefix + suffixes[i & 3]];
}

console.log(sum);
