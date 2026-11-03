// A record literal gets a value that is not of its declared type, out of a list that a type predicate let it into. Its entries are listed.
type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };
let shown = 0;
function show(value: unknown): void {
  if (shown++ < 80) console.log("shown", value instanceof Date ? "a date" : value);
}
function passThroughRecord<T>(value: T): T {
  const record: Record<string, T> = {};
  record.key = value;
  return record["key"];
}
let kept: undefined | null | object = undefined;
try {
  const passed: any = passThroughRecord<any>(Symbol.asyncDispose as any);
  kept = passed;
  {
    function listEntries(unused: [], start: number) {
      let tally = start;
      let share = 0.25;
      let letters = "";
      const trail: number[] = [];
      let ledger = { turns: 0 };
      try {
        function isAlways<T>(value: unknown): value is T {
          return true;
        }
        const loose: unknown = kept;
        const narrowed: (string | null)[] = [];
        if (isAlways<string | null>(loose)) narrowed.push(loose);
        const arrived: string | null = narrowed[0];
        const wrapFirst = (given: string | null): Outcome<string | null> => ({ ok: true, value: given });
        const first = wrapFirst(arrived);
        if (!first.ok) throw new RangeError(first.reason);
        const wrapSecond = (given: string | null): Outcome<string | null> => ({ ok: true, value: given });
        const second = wrapSecond(first.value);
        if (!second.ok) throw new RangeError(second.reason);
        const record: Record<string, string | null> = { key: second.value };
        show(Object.entries(record)[0][1]);
      } catch (error) {
        show((error as any)?.name);
      }
      show([tally, share, letters, trail.join(), ledger.turns].join(" "));
    }
    for (let turn = 0; turn < 1; turn++) listEntries([], 0);
  }
} catch (error) {}
