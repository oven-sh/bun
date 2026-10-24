import { NOTHING_YET, decide, type Limits, type Trouble, type Verdict } from "./policy";
export class StatusError extends Error {
  constructor(public status: number) {
    super("status " + status);
  }
}
function classify(error: unknown, couldHelp: boolean): Trouble | undefined {
  if (error instanceof StatusError) {
    if (error.status === 401 || error.status === 403) return undefined;
    return error.status === 529 && couldHelp ? { kind: "busy", after: 1 } : { kind: "status", status: error.status };
  }
  return undefined;
}
export function createKeeper(limits: Limits, left?: { count: number }) {
  let tally = NOTHING_YET;
  let tallyBefore = tally;
  let reported = false;
  let ended = false;
  const spent = () => left !== undefined && left.count <= 0;
  function count(error: unknown, couldHelp: boolean): { trouble: Trouble; verdict: Verdict } | undefined {
    if (ended) return undefined;
    try {
      const trouble = classify(error, couldHelp);
      if (trouble === undefined) return undefined;
      const result = decide(trouble, tally, limits, true);
      tally = result.tally;
      return { trouble, verdict: result.verdict };
    } catch {
      return undefined;
    }
  }
  function compare(expected: { trouble: Trouble; verdict: Verdict } | undefined, actual: Verdict | undefined): void {
    if (reported || expected === undefined || expected.verdict === actual) return;
    reported = true;
    console.log("differs", expected.verdict, actual);
  }
  return {
    spent,
    tally: () => tally,
    restore() {
      tally = tallyBefore;
    },
    remember() {
      tallyBefore = tally;
      ended = false;
    },
    gaveUp(error: unknown): Verdict {
      if (spent()) return "fail";
      const expected = count(error, false);
      const actual = expected?.verdict === "againPlain" ? "againPlain" : "fail";
      compare(expected, actual);
      return actual;
    },
    report(error: unknown, actual: Verdict | undefined, known?: { couldHelp: boolean }): void {
      const { plain } = tally;
      const expected = count(error, known?.couldHelp ?? false);
      tally = { ...tally, plain };
      if (expected === undefined && actual === "again") {
        tally = {
          ...tally,
          tries: Math.min(tally.tries + 1, limits.most),
        };
      }
      compare(expected, actual);
    },
  };
}
