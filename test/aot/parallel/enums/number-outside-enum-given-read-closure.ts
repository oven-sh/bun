// TypeScript takes any number for a numeric enum, so a parameter of the enum's type may hold a number that no member has. The build once stopped on this program with an internal error.
const seen: string[] = [];
function see(run: () => unknown): void {
  try { seen.push(String(run())); } catch (error) { seen.push((error as Error).name); }
}
enum Mode { Off, On }
const taken: (string | Promise<string>)[] = [];
const probe = (given: Mode): string => {
  let out = "";
  const checks: [string, () => unknown][] = [];
  const local: Mode = given;
  checks.push(["or-other", () => local || "other"]);
  for (const [, run] of checks) see(run);
  return out;
};
async function both(): Promise<void> {
  const honest = Mode.On;
  try {
    const loose: number = 2 ** 31;
    const typed = loose;
    taken.push(probe(typed));
  } catch (error) {}
  try { taken.push(probe(honest)); } catch (error) {}
}
try { both(); } catch (error) {}
console.log(seen.join(" "), taken.length);
