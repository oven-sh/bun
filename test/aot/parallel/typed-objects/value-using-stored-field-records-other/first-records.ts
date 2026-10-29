function passThroughRest<T>(value: T): T {
  return ((...values: T[]): T => values[0])(...[value]);
}
interface O34All {
  a?: O34 | null;
  c: number;
}
type O34 = Omit<O34All, "leftOut">;
const v9: O34 = passThroughRest<O34>([64, 1073741824, 9007199254740991, 1073741823] as any);
try {
  function F29() {}
} catch (e32) {
  console.error(String((e32 as any)?.message));
}
try {
  class C39 extends (BigInt64Array as any) {
    // @ts-ignore
    static get "!"(): void {
      const v48 = {
        valueOf(): void {
          for (let v44 = 0; v44 < 5; v44++) {}
        },
      };
    }
  }
} catch (e49) {
  console.error(String((e49 as any)?.message));
}
try {
  const v74 = {};
} catch (e75) {
  console.error(String((e75 as any)?.message));
}
