// The turns end inside the view, at its end, one past it and far past it.
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
function work(view: BigInt64Array, over: number): unknown { let s = 0.5; for (let i = 0; i < view.length + over; i++) s = s + view[i]!; return s; }
const view = hidden<BigInt64Array>(new BigInt64Array([1n, 2n, 3n, 4n]));
const none = hidden<BigInt64Array>(new BigInt64Array(0));
for (const over of [0, -1, 1, 5, -9]) console.log(over, attempt(() => work(view, over)), attempt(() => work(none, over)));
