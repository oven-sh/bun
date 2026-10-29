// A field `held` is declared a number in one literal and a list of strings in another. What a map of numbers answers is held in it and read again.
function convert(value: string): number;
function convert(value: unknown): unknown {
  return value;
}
let notes = 0;
function note(value: unknown): void {
  if (notes++ < 80) console.log("noted", value instanceof Date ? "a date" : value);
}
{
  function takePair(value: [number, string], other: bigint): void {
    try {
    } catch (error) {}
  }
  function* roundWhatIsHeld(value: boolean, other: string): Generator<number, void, unknown> {
    try {
      yield 1;
      let tally = 0;
      let share = 0.25;
      let letters = "";
      const trail: number[] = [];
      let ledger = { turns: 0 };
      const raise = (): void => {
        tally++;
      };
      raise();
      note(typeof value);
      const flag = !value;
      const numbers = new Map<string, number>([["key", flag as any]]);
      const answered = numbers.get("key")!;
      function readHeld(this: { held: number }): number {
        return this.held;
      }
      note(readHeld.apply({ held: answered }) == -3);
      note(Math.floor(readHeld.apply({ held: answered })));
      const converted = convert(other);
      const carried = converted;
      for (let i = 0; i < 2; i++)
        (() => {
          tally += i + 1;
          value;
        })();
      [1, 2].forEach(step => {
        tally += step;
      });
      note("abc".charAt(carried));
      note([tally, share, letters, trail.join(), ledger.turns].join(" "));
    } catch (error) {
      note((error as any)?.name);
      console.error(String((error as any)?.["message"]));
    }
  }
  try {
    note([...roundWhatIsHeld({ kind: "first" } as any, { kind: "first" } as any)]);
  } catch (error) {
    note("threw");
    console.error(String((error as any)?.["message"]));
  }
  try {
    note([...roundWhatIsHeld(10n as any, true as any)]);
  } catch (error) {
    note("threw");
    console.error(String((error as any)?.["message"]));
  }
}
{
  function holdList() {
    try {
      // @ts-ignore
      const shelf: { held: string[] } = { held: arrived };
    } catch (error) {}
  }
}
