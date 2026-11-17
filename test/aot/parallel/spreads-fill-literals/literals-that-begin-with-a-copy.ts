// `{ ...state, .. }`: which names the literal has, in which order, and what each holds, whatever became of the objects that it copies.
declare const process: { readonly argv: readonly string[] };
export {};
interface State { count: number; name: string; ratio: number; isOn: boolean; note: string | null }
const turns = process.argv.length + 3;
const defaults: State = { count: 1, name: "first", ratio: 0.5, isOn: true, note: null };
const show = (title: string, made: any): void => {
  const names: string[] = [];
  for (const name in made) names.push(name);
  console.log(title, names.join(), JSON.stringify(made), made.count + made.ratio, made.isOn === true, typeof made.note, String(made.name));
};

// Nobody changes an object of this layout.
const withDefaults = (given: Partial<State>): State => ({ ...defaults, ...given });
const next = (state: State, turn: number): State => ({ ...state, count: state.count + turn, ratio: state.ratio * 2 });
let state = withDefaults({ name: "second" });
for (let turn = 0; turn < 40 * turns; turn++) {
  state = next(state, turn & 1);
  if (turn % 50 === 0) state = { ...state, isOn: !state.isOn, ratio: 0.5, note: turn ? "turn" + turn : null };
}
show("state", state);
show("numbers", { ...withDefaults({ count: -0, ratio: NaN }), name: "n" });
show("large", next(withDefaults({ count: 2 ** 40, ratio: 1e300 }), 2 ** 31));
console.log(Object.is({ ...withDefaults({ count: -0 }) }.count, -0), Object.keys({ ...withDefaults({}) }).join());
const thrown = (turn: number): State => ({ ...state, count: mayThrow(turn) });
function mayThrow(turn: number): number { if (turn > 1) throw new RangeError("turn " + turn); return turn; }
for (let turn = 0; turn < 3; turn++) { try { show("thrown", thrown(turn)); } catch (error) { console.log((error as Error).message); } }
async function later(given: State): Promise<State> { return { ...given, count: await Promise.resolve(given.count + 7) }; }
function* yields(given: State): Generator<number, State, number> { return { ...given, count: yield given.count }; }
const steps = yields(state);
console.log(steps.next().value);
show("yielded", steps.next(99).value);
later(state).then(made => show("later", made));

// Each of these has names of its own, so each has a layout of its own, and one of its objects is changed in front of the copy.
function changed(title: string, make: (turn: number) => any, change: (made: any, turn: number) => void, copy: (made: any) => any): void {
  for (let turn = 0; turn < 3; turn++) {
    const made = make(turn);
    try { if (turn === 1) change(made, turn); } catch (error) { console.log(title, (error as Error).constructor.name); }
    const copied = copy(made);
    console.log(title, Object.keys(copied).join(), JSON.stringify(copied), copied.b === undefined, String(copied.b), copied.a + 1, "b" in copied);
  }
}
changed("deleted", turn => ({ a: turn, b: "b", deleted: 1 }), made => { delete made.b; }, made => ({ ...made, deleted: 2 }));
changed("deletedAndStored", turn => ({ a: turn, b: "b", deletedAndStored: 1 }), made => { delete made.a; made.a = 5; }, made => ({ ...made, deletedAndStored: 2 }));
changed("hidden", turn => ({ a: turn, b: "b", hidden: 1 }), made => { Object.defineProperty(made, "b", { value: "h", enumerable: false }); }, made => ({ ...made, hidden: 2 }));
changed("getter", turn => ({ a: turn, b: "b", getter: 1 }), made => { Object.defineProperty(made, "b", { get() { return "got"; }, enumerable: true }); }, made => ({ ...made, getter: 2 }));
changed("frozen", turn => ({ a: turn, b: "b", frozen: 1 }), made => { Object.freeze(made); }, made => ({ ...made, frozen: 2 }));
changed("added", turn => ({ a: turn, b: "b", added: 1 }), (made, turn) => { made["more" + turn] = turn; }, made => ({ ...made, added: 2 }));
changed("below", turn => ({ a: turn, b: "b", below: 1 }), made => { Object.setPrototypeOf(made, { above: 1 }); }, made => ({ ...made, below: 2 }));
changed("ordered", turn => (turn & 1 ? { ordered: 1, b: "b", a: turn } : { a: turn, b: "b", ordered: 1 }), () => {}, made => ({ ...made, ordered: 2 }));
changed("parsed", turn => (turn & 1 ? JSON.parse('{"a":1,"parsed":0}') : { a: turn, b: "b", parsed: 1 }), () => {}, made => ({ ...made, parsed: 2 }));
changed("proxy", turn => (turn & 1 ? new Proxy({ a: turn, b: "b", proxy: 1 }, {}) : { a: turn, b: "b", proxy: 1 }), () => {}, made => ({ ...made, proxy: 2 }));
changed("nothing", turn => ({ a: turn, b: "b", nothing: 1 }), () => {}, made => ({ a: 1, ...(made.a === 1 ? undefined : made), nothing: 2 }));
changed("shorter", turn => (turn & 1 ? { a: turn, shorter: 1 } : { a: turn, b: "b", shorter: 1 }), () => {}, made => ({ ...made, shorter: 2 }));
