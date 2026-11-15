// A reducer copies its state by spread. The slots of the state hold a text, a list and a number while the loop runs; then other things arrive in them by other roads, and the copies hold what plain Bun's hold.
function reducer(state, action) { switch (action.type) { case "add": return { ...state, items: [...state.items, action.item], count: state.count + 1 }; case "clear": return { ...state, items: [], count: 0 }; case "rename": return { ...state, name: action.name }; default: return state; } }
function run(state, n) { let total = 0; const actions = [{ type: "add", item: 1 }, { type: "add", item: 2 }, { type: "rename", name: "t" }, { type: "clear" }, { type: "noop" }]; for (let i = 0; i < n; i++) { state = reducer(state, actions[i % 5]); total += state.count + state.items.length; } return [total, state]; }
function show(state) { return Object.keys(state).join() + ":" + String(state.name) + ":" + String(state.items) + ":" + String(state.count); }
const out = [];
const [total, last] = run({ name: "s", items: [], count: 0 }, 5003);
out.push(total, show(last));
const odd = [
  { name: 7, items: [], count: 0 }, { name: null, items: "ab", count: "c" }, { name: undefined, items: [1], count: 1.5 }, { name: { deep: 1 }, items: new Set([3]), count: 10n },
  { items: [], count: 0, name: "order" }, { name: "more", items: [], count: 0, extra: true }, Object.freeze({ name: "frozen", items: [], count: 0 }), Object.create({ name: "above", items: [9], count: 4 }),
];
for (const state of odd) {
  for (const type of ["rename", "clear", "add", "noop"]) {
    try { out.push(show(reducer(state, { type, name: "n", item: 5 }))); } catch (error) { out.push(error.name); }
  }
}
const written = { name: "s", items: [], count: 0 };
written.name = 5; written.items = "text"; written.count = [];
out.push(show(reducer(written, { type: "rename", name: 6 })), show(reducer(reducer(written, { type: "noop" }), { type: "clear" })));
console.log(out.join(" | "));
