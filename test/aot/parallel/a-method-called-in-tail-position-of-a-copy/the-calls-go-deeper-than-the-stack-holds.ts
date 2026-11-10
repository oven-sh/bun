const deep = { down(level: number): number { return level <= 0 ? 0 : step(this, level - 1) + 1; } };
const flat = { down(level: number): number { return level; } };
const enter = (holder: any, level: number) => holder.down(level);
function step(holder: any, level: number): number {
  const below = enter(holder, level);
  return below + 0;
}
const holders: any[] = JSON.parse("[0, 1]").map((which: number) => (which ? flat : deep));
console.log(step(holders[0], 2000), step(holders[1], 2000));
let kind = "none";
try { step(holders[0], 50_000_000); } catch (error) { kind = (error as Error).constructor.name; }
console.log(kind);
console.log(step(holders[0], 2000), step(holders[1], 7));
