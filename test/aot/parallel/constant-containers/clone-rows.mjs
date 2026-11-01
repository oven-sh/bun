const initial = { rows: [0, 1, 2].map(() => ["", "", ""]) };
let state = structuredClone(initial);
state.rows[0][0] = "x";
console.log(`[${state.rows[0][0]}][${state.rows[1][0]}][${state.rows[2][0]}]`);
