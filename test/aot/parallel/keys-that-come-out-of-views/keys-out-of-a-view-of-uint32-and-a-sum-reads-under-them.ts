// The turns end inside the view of keys, at its end, one past it and three past it.
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
function work(words: Int32Array, keys: Uint32Array, over: number): unknown { let s = 0; for (let i = 0; i < keys.length + over; i++) s = (s + words[keys[i]!]!) | 0; return s; }
const keys = hidden<Uint32Array>(new Uint32Array([0, 4294967295, 1, 3, 2]));
for (const over of [0, -1, 1, 3]) console.log(over, attempt(() => work(hidden(new Int32Array([5, -6, 7, 8])), keys, over)));
