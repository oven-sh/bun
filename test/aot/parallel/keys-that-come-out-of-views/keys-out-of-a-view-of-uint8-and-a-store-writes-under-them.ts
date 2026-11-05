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
function work(words: Int32Array, keys: Uint8Array, over: number): unknown { for (let i = 0; i < keys.length + over; i++) words[keys[i]!] = i + 10; return words.join() + ":" + show((words as any).undefined); }
const keys = hidden<Uint8Array>(new Uint8Array([0, 2, 255, 3, 1]));
for (const over of [0, -1, 1, 3]) console.log(over, attempt(() => work(hidden(new Int32Array([5, -6, 7, 8])), keys, over)));
