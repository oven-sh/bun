// stored while it is read in a loop
const k: string = JSON.parse('"env"');
const p: any = process;
const seen: unknown[] = [];
const first = process.env;
function look() { seen.push(process.env === first, typeof process.env, (process.env as any)?.WATCHED); }
p[k + "NotAMember"] = 1;
for (let i = 0; i < 6; i++) {
  const inFront = process.env;
  if (i === 3) p[k] = { WATCHED: "in the loop" };
  seen.push(inFront === first, process.env === first, (process.env as any).WATCHED);
}
console.log(seen.join());
