// undefined is a name like another: what lies under it is found, and what runs at the read runs once.
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
let asked = 0;
function work(words: Int32Array, keys: Int32Array, over: number): unknown { let s = 0; for (let i = 0; i < keys.length + over; i++) s = (s + words[keys[i]!]!) | 0; return s + ":" + asked; }
const words = hidden<Int32Array>((() => { return new Proxy({}, { get: (_, name) => { asked++; return String(name).length; } }); })());
const keys = hidden<Int32Array>(new Int32Array([0, 2, 1, 3]));
for (const over of [0, 1, 2]) console.log(over, attempt(() => work(words, keys, over)));
