// A position outside a view finds nothing, whatever lies behind the view in memory.
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
function work(view: Int32Array, over: number): unknown { let s = 0; for (let i = 0; i < view.length + over; i++) s = s + view[i]!; return s; }
const view = hidden<Int32Array>((() => { const buffer = new ArrayBuffer(16, { maxByteLength: 32 }); const view = new Int32Array(buffer); view.set([1, 2, 3, 4]); buffer.resize(8); return view; })());
for (const over of [0, -1, 1, 2, 10]) console.log(over, attempt(() => work(view, over)));
