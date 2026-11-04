// a small async function awaits a call of itself without end, with a number and with what its parameter is not: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
async function down(by: number, n: number): Promise<number> {
  turns++;
  if (limit && turns >= limit) return n;
  return (await down(by, n + by)) + by;
}
async function deed(by: unknown) {
  turns = 0;
  try {
    return String(await down(by as number, 0));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(await deed(1));
for (let i = 0; i < 3; i++) console.log(await deed(i & 1 ? 2 : "s"));
limit = 5;
console.log(await deed(1));
console.log(await deed("s"));
