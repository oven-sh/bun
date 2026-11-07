// A wide context object, half of whose fields are callbacks, copied with a few changes at many places.
type State = { count: number; label: string };
type Context = {
  options: { debug: boolean; model: string; tools: string[] };
  value0?: number;
  value1: string;
  value2: boolean;
  value3?: number[];
  value4: number;
  value5: string;
  value6?: boolean;
  value7: number[];
  value8: number;
  value9?: string;
  value10: boolean;
  value11: number[];
  value12?: number;
  value13: string;
  value14: boolean;
  value15?: number[];
  value16: number;
  value17: string;
  value18?: boolean;
  value19: number[];
  handler0: (input: number) => void;
  handler1?: (input: string) => number;
  handler2: (input: number) => string;
  handler3?: (input: string) => void;
  handler4: (input: number) => number;
  handler5?: (input: string) => string;
  handler6: (input: number) => void;
  handler7?: (input: string) => number;
  handler8: (input: number) => string;
  handler9?: (input: string) => void;
  handler10: (input: number) => number;
  handler11?: (input: string) => string;
  handler12: (input: number) => void;
  handler13?: (input: string) => number;
  handler14: (input: number) => string;
  handler15?: (input: string) => void;
  handler16: (input: number) => number;
  handler17?: (input: string) => string;
  handler18: (input: number) => void;
  handler19?: (input: string) => number;
  getState: () => State;
  setState: (update: (previous: State) => State) => void;
  depth?: number;
  parent?: string;
};
let state: State = { count: 0, label: "start" };
let sink = 0;
class Owner {
  total = 0;
  add(input: number): number { this.total += input; return this.total; }
  size(input: string): number { return input.length + this.total; }
}
function makeContext(seed: number, owner: Owner): Context {
  const context: Context = {
    options: { debug: seed % 2 === 0, model: "m" + seed, tools: ["a", "b"] },
    value1: "s1",
    value2: seed % 2 === 0,
    value4: seed + 4,
    value5: "s5",
    value7: [seed, 7],
    value8: seed + 8,
    value10: seed % 2 === 0,
    value11: [seed, 11],
    value13: "s13",
    value14: seed % 2 === 0,
    value16: seed + 16,
    value17: "s17",
    value19: [seed, 19],
    handler0: input => { sink += Number(input); },
    handler2: input => String(input) + seed,
    handler4: input => Number(input) + seed,
    handler6: input => { sink += Number(input); },
    handler8: input => String(input) + seed,
    handler10: input => Number(input) + seed,
    handler12: input => { sink += Number(input); },
    handler14: input => String(input) + seed,
    handler16: input => Number(input) + seed,
    handler18: input => { sink += Number(input); },
    getState: () => state,
    setState: update => { state = update(state); },
  };
  if (seed % 3 === 0) context.value0 = seed;
  if (seed % 4 === 0) context.handler1 = owner.size.bind(owner);
  if (seed % 5 === 0) context.handler3 = input => { sink += input.length; };
  return context;
}
function withDepth(context: Context, depth: number): Context { return { ...context, depth }; }
function withParent(context: Context, parent: string): Context { return { ...context, parent, value1: parent }; }
function withHandler(context: Context, owner: Owner): Context { return { ...context, handler0: owner.add.bind(owner), setState: update => { state = update(state); sink++; } }; }
function withOptions(context: Context): Context { return { ...context, options: { ...context.options, debug: true } }; }
function use(context: Context): void {
  context.handler0(1); context.handler2(2); context.setState(previous => ({ ...previous, count: previous.count + 1 }));
  sink += (context.depth ?? 0) + context.value1.length + Object.keys(context).length + (context.handler1 ? context.handler1("x") : 0);
}
const rounds = Number(process.argv[2] ?? 3);
const owner = new Owner();
for (let round = 0; round < rounds; round++) {
  for (let seed = 0; seed < 12; seed++) {
    const context = makeContext(seed, owner);
    const a = withDepth(context, round); const b = withParent(a, "p" + seed); const c = withHandler(b, owner); const d = withOptions(c);
    use(a); use(b); use(c); use(d);
    if (round < 2) console.log(round, seed, Object.keys(d).join(","), d.depth, d.parent, d.value1, d.options.debug, typeof d.handler1, typeof d.handler3, d.getState().count);
  }
}
console.log(sink, state.count, owner.total);
