// A view over a context: a literal whose members are getters, made anew for each call, of which the caller reads three. Each getter costs a closure, a pair and a store, whether it is read or not.
interface Context { id: number; name: string; tools: string[]; limit: number; flags: { a: boolean; b: boolean }; state: { count: number } }
interface View {
  readonly id: number; readonly name: string; readonly tools: string[]; readonly limit: number; readonly a: boolean; readonly b: boolean; readonly count: number; readonly label: string;
  readonly first: string | undefined; readonly size: number; readonly half: number; readonly twice: number;
  bump(): void;
}
function viewOf(context: Context): View {
  return {
    get id() { return context.id; },
    get name() { return context.name; },
    get tools() { return context.tools; },
    get limit() { return context.limit; },
    get a() { return context.flags.a; },
    get b() { return context.flags.b; },
    get count() { return context.state.count; },
    get label() { return context.name + context.id; },
    get first() { return context.tools[0]; },
    get size() { return context.tools.length; },
    get half() { return context.limit >> 1; },
    get twice() { return context.limit * 2; },
    bump: () => { context.state.count++; },
  };
}
const kept: View[] = [];
function use(view: View, i: number): number {
  kept[i & 7] = view;
  view.bump();
  return view.id + view.count + view.size;
}
const context: Context = { id: 3, name: "c", tools: ["x", "y"], limit: 10, flags: { a: true, b: false }, state: { count: 0 } };
let sum = 0;
for (let i = 0; i < 30_000; i++) sum = (sum + use(viewOf(context), i)) | 0;
console.log(sum, kept.length, Object.keys(kept[3]!).length);
