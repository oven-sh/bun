// makes objects from eight prototypes at one site
const prototypes: object[] = [];
for (let n = 0; n < 8; n++) prototypes.push({ ["tag" + n]: n });
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const made = Object.create(prototypes[i & 7]!);
    if (made !== null) total++;
  }
}

console.log(total);
