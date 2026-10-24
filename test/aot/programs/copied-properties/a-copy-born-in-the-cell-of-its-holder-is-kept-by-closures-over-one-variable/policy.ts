export type Tally = {
  tries: number;
  slept: number;
  busy: number;
  stalls: number;
  cuts: number;
  early: number;
  filtered: number;
  plain: boolean;
};
export const NOTHING_YET: Tally = { tries: 0, slept: 0, busy: 0, stalls: 0, cuts: 0, early: 0, filtered: 0, plain: false };
export type Limits = { most: number; mostSlept: number };
export type Trouble = { kind: "none" } | { kind: "busy"; after: number } | { kind: "status"; status: number };
export type Verdict = "fail" | "again" | "againPlain" | "keep";
export function decide(trouble: Trouble, tally: Tally, limits: Limits, counted: boolean): { tally: Tally; verdict: Verdict } {
  if (trouble.kind === "busy") return { tally: { ...tally, busy: tally.busy + 1 }, verdict: tally.busy < limits.most ? "again" : "fail" };
  if (trouble.kind === "status" && trouble.status >= 500 && counted) return { tally: { ...tally, tries: tally.tries + 1 }, verdict: tally.tries < limits.most ? "again" : "fail" };
  return { tally, verdict: "fail" };
}
