// The words are asked for in front of the loop, so there is a second build of it to leave for.
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
function work(view: Int32Array, a: number, b: number, to: number): unknown { for (let i = 0; i < to; i++) { a = (((a << 5) | (a >>> 27)) + view[i]! + b) | 0; b = a ^ i; } return a + ":" + b; }
const view = hidden<Int32Array>(new Int32Array([1, -2, 3, 4]));
for (const to of [0, 1, 4, 5, 12]) console.log(to, attempt(() => work(view, hidden(7), hidden(-9), to)), attempt(() => work(view, hidden(0.5), hidden(2 ** 40), to)));
