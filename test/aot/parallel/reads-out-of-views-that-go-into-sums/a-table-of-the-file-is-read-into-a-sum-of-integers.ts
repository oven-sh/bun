// Nobody has written what the table is: it is what a call gave.
const show = (value: any): string => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value));
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
function hidden<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
const table = Int32Array.from([3, 1, -4, 1, 5]);
function work(to: number): unknown { let s = 0; for (let i = 0; i < to; i++) s = (s + table[i]!) | 0; return s; }
for (const to of [0, 3, 5, 6, 40]) console.log(to, attempt(() => work(hidden(to))));
