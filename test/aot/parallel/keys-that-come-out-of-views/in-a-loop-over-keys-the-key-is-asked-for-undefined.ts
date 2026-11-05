// Whichever build of the loop runs, and wherever it is left.
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
const hook = hidden<(i: number) => void>(() => {});
const marks = new Int32Array(4);
let turns = 0;
function work(words: Int32Array, keys: Int32Array): unknown { let s = 0; for (let i = 0; i <= keys.length; i++) { const key = keys[i]; s = key === undefined ? s - 1 : (s + words[key]!) | 0; } return s; }
for (const made of [[0, 2, 1, 3], [1], [], [3, 3, 0, 9, -1, 2]]) console.log(attempt(() => work(hidden(new Int32Array([5, -6, 7, 8])), hidden(new Int32Array(made)))));
