interface Part { name: string; weight: number }
function mark(part: Part): number {
  let hit = 0;
  if (part.name === "n0" || part.name === "n3" || part.name === "n6" || part.name === "n9" || part.name === "n12" || part.name === "n15" || part.name === "n18" || part.name === "n21" || part.name === "n24" || part.name === "n27" || part.name === "n30" || part.name === "n33") hit = 1;
  return hit;
}
let line = "";
for (let i = 0; i < 40; i++) line += mark({ name: "n" + i, weight: i });
console.log(line);
