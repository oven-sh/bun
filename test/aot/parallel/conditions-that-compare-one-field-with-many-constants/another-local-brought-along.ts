interface Part { name: string; weight: number }
function weigh(part: Part, base: number): number {
  let extra = base * 2;
  const other = part;
  if (part.name === "n0" || part.name === "n2" || part.name === "n4" || part.name === "n6" || part.name === "n8" || part.name === "n10" || part.name === "n12" || part.name === "n14" || part.name === "n16") extra += other.weight + part.weight;
  return extra + other.weight + base;
}
let line = "";
for (let i = 0; i < 24; i++) line += weigh({ name: "n" + i, weight: i + 1 }, i) + ",";
console.log(line);
