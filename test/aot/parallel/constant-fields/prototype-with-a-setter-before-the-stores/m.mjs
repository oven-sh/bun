const E = {};
Object.setPrototypeOf(E, { set A(v) { console.log("setter runs", v); } });
E.A = 0;
E.B = 1;
export const read = () => [E.A, E.B].join();
