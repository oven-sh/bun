const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { trim: (s: string): string => s.trim(), round: Math.floor };
unseen(kit);
function take(at: number, tools: { trim: (s: string) => string; round: (x: number) => number }): string {
  const [a, { deep }, c] = [tools.trim("  t" + at + " "), { deep: tools.round(at + 0.5) }, at];
  return a + ":" + deep + ":" + c;
}
console.log(take(1, kit), take(2, kit));
