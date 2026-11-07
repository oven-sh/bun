interface Look { tint?: string; heavy?: boolean }
interface Plan { span?: number; rows?: number; look?: Look; after?: (width: number) => void }
function draw({ span = 80, rows, look: { tint = "none", heavy = false } = {}, after }: Plan = {}): number {
  const height = rows ?? 24;
  after?.(span);
  return span + height + tint.length + (heavy ? 1 : 0);
}
function run(turns: number): number {
  let total = 0, seen = 0;
  const note = (width: number) => { seen += width; };
  for (let i = 0; i < turns; i++)
    total += draw({ span: i & 63 }) + draw({ rows: 10, look: { heavy: true } }) + draw({ look: { tint: "red" }, after: note }) + draw();
  return total + seen;
}
console.log(run(30000));
