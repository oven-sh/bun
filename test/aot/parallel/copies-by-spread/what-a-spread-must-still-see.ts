type State = { a: number; b: number };
function widen(state: State, c: number) { return { ...state, c }; }
function again(state: State) { return { ...state }; }
(globalThis as any).keep = [widen, again];
function show(o: object) { return JSON.stringify(o) + Object.keys(o).join(","); }
const said: string[] = [];
const plain: State = { a: 1, b: 2 };
const turned = { b: 2, a: 1 } as State;
const wider = { a: 1, b: 2, c: 9, d: 4 } as State;
const grown: any = { a: 1, b: 2 }; grown.z = 7;
const shrunk: any = { a: 1, b: 2 }; delete shrunk.a;
const frozen = Object.freeze({ a: 1, b: 2 }) as State;
const getter = Object.defineProperty({ a: 1, b: 2 }, "a", { get() { return 5; }, enumerable: true }) as State;
const hidden = Object.defineProperty({ a: 1, b: 2 }, "b", { enumerable: false }) as State;
const marked: any = { a: 1, b: 2 }; marked[Symbol.for("m")] = 1;
const below = Object.create({ up: 1 }, { a: { value: 1, enumerable: true }, b: { value: 2, enumerable: true } }) as State;
for (let round = 0; round < 3; round++) {
  for (const state of [plain, turned, wider, grown, shrunk, frozen, getter, hidden, marked, below, null as any, undefined as any, 5 as any, "xy" as any]) {
    said.push(show(widen(state, round)), show(again(state)), String(Object.getOwnPropertySymbols(widen(state, 0)).length), String(Object.isFrozen(again(state))));
  }
}
console.log(said.join("|"));
