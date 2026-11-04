const initial = { rows: [0, 1, 2].map(() => [0, 0]) };
const state = structuredClone(initial);
console.log(state.rows[0] === state.rows[1] ? "one list" : "two lists");
