const base = { set A(v) { console.log("setter runs", v); } };
const E = { __proto__: base };
E.A = 0;
E.B = 1;
export const read = () => [E.A, E.B].join();
