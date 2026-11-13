declare const process: { readonly argv: readonly string[] };
export {};
enum Level { Debug, Info, Warn, Error }
const open = Level as unknown as Record<number, unknown>;
const hidden = <T>(value: T): T => ({ value } as Record<string, T>)[JSON.parse('"value"') as string]!;
function f(t: number): number { let s = 0; for (let i = 0; i < 100; i++) s += Level[(i + t) & 3]!.length; return s; }
const go = hidden(f);
const ask = (t: number): string => { try { return String(go(t)); } catch (error) { return (error as Error).constructor.name; } };
const said = [ask(0)];
let asked = 0; Object.defineProperty(open, 2, { get() { asked++; return asked & 1 ? "ab" : [1, 2, 3]; } });
said.push(ask(0), ask(+(process.argv[2] ?? 1)));
console.log(said.join(" | "));
