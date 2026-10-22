// A method of a class of the program is called on a receiver that is only expected to be of that class: it comes out of a call through a variable typed by an ambient function declaration. The argument is an object literal. The literal is made once, as what the parameter's type says, whichever function is called; another function sees an object that behaves as a plain one. In code that runs once.
// IR= 1 effect : =?L[0-9]+ = NewObject 
// IR= 0 effect IsClosureOf
type Fn = (n: number) => number;
type T = { a: string; b: Fn; c: Fn | undefined; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number };
class Control { #host: T | null = null; attachPart(host: T): void { this.#host = host; } show(): string { const h = this.#host; return h ? h.a + h.b(1) + (h.c ? h.c(2) : "-") + (h.o10 ?? "-") : "none"; } }
declare function ambientControl(): Control;
const made = new Control();
made.attachPart({ a: "k", b: n => n, c: undefined, o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 });
console.log(made.show());
let hook: typeof ambientControl = () => made;
const effects: (() => void)[] = [];
function Component(): string {
  const control = hook();
  const a = "s"; const b: Fn = n => n + 1; const c: Fn | undefined = undefined;
  effects.push(function effect() { control.attachPart({ a, b, c }); });
  return "rendered";
}
function attempt(name: string, f: () => string): void { try { console.log(name, f()); } catch (e) { console.log(name, (e as Error).name + ": " + (e as Error).message.split("\n")[1]?.trim().slice(0, 110)); } }
attempt("the method that is expected:", () => { const out = Component(); for (const effect of effects.splice(0)) effect(); return out + " " + made.show(); });
let seen = "";
const other = { attachPart(host: unknown): void { const h = host as { a: string; extra?: number }; h.extra = 1; seen = Object.keys(h).join() + " " + String(Object.getPrototypeOf(h) === Object.prototype); } };
attempt("another function:", () => { hook = (() => other) as unknown as typeof ambientControl; const out = Component(); for (const effect of effects.splice(0)) effect(); return out + " " + seen; });
attempt("the method replaced on the object:", () => { const mine = new Control(); (mine as any).attachPart = function (host: any) { seen = "replaced " + Object.keys(host).join(); }; hook = () => mine; const out = Component(); for (const effect of effects.splice(0)) effect(); return out + " " + seen + " " + mine.show(); });
attempt("nothing there:", () => { hook = (() => undefined) as unknown as typeof ambientControl; const out = Component(); for (const effect of effects.splice(0)) effect(); return out; });
