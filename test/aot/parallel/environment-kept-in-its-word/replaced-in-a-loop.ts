// replaced in a loop
const seen: unknown[] = [];
const first = process.env;
for (let i = 0; i < 4; i++) {
  if (i === 2) process.env = { TURN: String(i) } as any;
  seen.push(process.env === first, process.env.TURN);
}
console.log(seen.join());
