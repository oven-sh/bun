// A literal leaves an optional field out, and the next statement stores a function into it that closes over the object: two steps, so that the function can name the object.
declare const process: { argv: string[] };
declare const console: { log(...values: any[]): void };
type Context = { cwd: string; depth: number; verbose?: boolean; root?: string; file?: () => number; parent?: Context };
function load(context: Context): number { return context.cwd.length + context.depth; }
function makeContext(cwd: string, depth: number): Context {
  const context: Context = { cwd, depth, verbose: depth > 2 };
  context.file = () => load(context);
  return context;
}
{ (globalThis as any).kept = [makeContext, load]; const somebody: any = (globalThis as any)[JSON.parse('"somebody"')] ?? {}; somebody[JSON.parse('"something"')] = 1; Object.defineProperty(somebody, JSON.parse('"other"'), { get() { return 1; }, configurable: true }); }
const rounds = Number(process.argv[2]);
let sum = 0;
for (let i = 0; i < rounds; i++) {
  const context = makeContext(i & 1 ? "/a" : "/home", i & 3);
  sum += context.file!() + (context.verbose ? 1 : 0);
}
console.log(sum);
