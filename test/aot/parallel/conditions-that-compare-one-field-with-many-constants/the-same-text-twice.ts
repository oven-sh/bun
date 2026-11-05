interface Part { name: string; weight: number }
function weigh(part: Part): number {
  let extra = 0;
  if (part.name === "a" || part.name === "b" || part.name === "a" || part.name === "c" || part.name === "b" || part.name === "d") extra = part.weight;
  return extra + part.weight;
}
let line = "";
for (const name of ["a", "b", "c", "d", "e", ""]) line += weigh({ name, weight: 5 }) + ",";
console.log(line);
