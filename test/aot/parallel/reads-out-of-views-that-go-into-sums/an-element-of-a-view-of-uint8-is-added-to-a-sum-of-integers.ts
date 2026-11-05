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
function work(view: Uint8Array, over: number): unknown { let s = 0; for (let i = 0; i < view.length + over; i++) s = (s + i + view[i]!) | 0; return s; }
const view = hidden<Uint8Array>(new Uint8Array([1, 200, 3, 4]));
const none = hidden<Uint8Array>(new Uint8Array(0));
for (const over of [0, -1, 1, 5, -9]) console.log(over, attempt(() => work(view, over)), attempt(() => work(none, over)));
