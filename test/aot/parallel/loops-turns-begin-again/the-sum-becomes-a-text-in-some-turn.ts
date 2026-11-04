// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
function run(values: number[]): string {
  let total: any = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return String(total);
}
function main() {
  const values: number[] = [];
  for (let i = 0; i < 200; i++) values.push(i);
  (values as any)[120] = "|";
  (globalThis as any).values = values;
  (0, eval)("1");
  const answer = run(values);
  console.log(answer.length, answer.slice(0, 16));
}
main();
