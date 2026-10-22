// The shape: a function builds a typed literal whose members are arrow functions that capture nothing, stores one more member that captures the literal, and returns it.
interface Context {
  first: () => number;
  second: () => string;
  third: (source: string) => string;
  fourth: () => boolean;
  fifth: () => number;
  file: () => number;
}
let calls = 0;
function one() { return ++calls; }
function two() { return "two" + calls; }
function three(source: string) { return source + calls; }
function four() { return calls % 2 === 0; }
function load(context: Context) { return context.first() + context.fifth(); }
function fullContext(): Context {
  const context = {
    first: () => one(),
    second: () => two(),
    third: source => three(source),
    fourth: () => four(),
    fifth: () => one() + 1,
  } as Context;
  context.file = () => load(context);
  return context;
}
function use(context: Context, n: number) {
  return n % 3 === 0 ? context.file() : n % 3 === 1 ? context.first() : context.third("x").length;
}
let sum = 0;
for (let i = 0; i < 10000; i++) sum += use(i % 100 === 0 ? { ...fullContext(), fifth: () => 3 } : fullContext(), i);
console.log(sum, fullContext().second(), fullContext().fourth(), fullContext().first !== fullContext().first);
