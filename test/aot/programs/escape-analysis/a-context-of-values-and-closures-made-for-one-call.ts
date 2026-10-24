// A factory makes a context of plain values and closures for one call. The callee reads one member on the frequent path and hands the context on only when its cache misses.
const N = 200000;

interface Store { cache: Map<string, number>; misses: number }
interface Context {
  store: Store;
  root: string | null;
  limit: number;
  verbose: boolean;
  label?: string;
  now: () => number;
  describe: (name: string) => string;
  fallback: () => number;
  again?: () => number;
}

const store: Store = { cache: new Map(), misses: 0 };
let clock = 0;
let root: string | null = "/";
function currentStore(): Store { return store; }
function currentRoot(): string | null { return root; }
function currentLimit(): number { return clock & 1023; }
function tick(): number { return ++clock; }

function fullContext(): Context {
  const context: Context = {
    store: currentStore(),
    root: currentRoot(),
    limit: currentLimit(),
    verbose: clock > 1e9,
    now: () => tick(),
    describe: name => name + "@" + clock,
    fallback: () => -1,
  };
  context.again = () => compute("again", context);
  return context;
}

function compute(name: string, context: Context): number {
  context.store.misses++;
  const base = context.root === null ? context.fallback() : context.root.length + context.now();
  return base + context.describe(name).length + (context.verbose ? 1 : 0) + (name === "twice" && context.again ? context.again() : 0) + context.limit * 0;
}

function lookUp(name: string, context: Context): number {
  const cached = context.store.cache.get(name);
  if (cached !== undefined) return cached;
  const value = compute(name, context);
  context.store.cache.set(name, value);
  return value;
}

function valueOf(name: string): number {
  return lookUp(name, fullContext());
}

const names = ["a", "bb", "ccc", "twice", "eeeee"];
let sum = 0;
for (let i = 0; i < N; i++) {
  sum = (sum + valueOf(names[i % names.length])) | 0;
  if (i % 50000 === 49999) store.cache.clear();
}
console.log(sum, store.misses, clock);
