const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor, fail: (): number => { throw new Error("no"); } };
unseen(kit);
function take(at: number, tools: { round: (x: number) => number; fail: () => number }): string {
  let a: number | undefined = -1, b = -1;
  try {
    [a = tools.fail(), b] = [at > 1 ? undefined : at, tools.round(at + 0.5)];
  } catch (e) {
    return "caught " + (e as Error).message + " " + a + ":" + b;
  }
  return a + ":" + b;
}
console.log(take(1, kit), take(2, kit));
