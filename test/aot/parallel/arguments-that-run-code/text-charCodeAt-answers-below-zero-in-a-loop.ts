// One deed a program: the receiver is read, then the method, and the read that makes the argument runs code. A primitive stays what it is whatever runs; the shape of an object does not. Made by staging/a-primitive-stays-what-it-is-1/make-family-of-arguments.py.
const said: string[] = [];
const brief = (v: any): string => { try { return typeof v === "string" ? JSON.stringify(v) : String(v); } catch (e) { return "unprintable"; } };
function attempt(f: () => unknown) { try { said.push(brief(f())); } catch (e) { said.push((e as Error).constructor.name); } }
type Source = { text: string; position: number };
let turns = 0;
const source: Source = { text: "abc def", position: 0 };
const plain: Source = { text: "plain text", position: 3 };
Object.defineProperty(source, "position", { get(this: any) { return -1; }, configurable: true, enumerable: true });
function read(s: Source) { return s.text.charCodeAt(s.position); }
function readInLoop(s: Source, times: number) { let last: unknown; for (let i = 0; i < times; i++) last = s.text.charCodeAt(s.position); return last; }
(globalThis as any).kept = source;
attempt(() => read(plain)); attempt(() => readInLoop(plain, 3));
attempt(() => { let all = ""; for (let i = 0; i < 6; i++) all += brief(readInLoop(source, 2)); return all; });
console.log(said.join(" "));
