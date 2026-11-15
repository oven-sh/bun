const E = {};
globalThis.leaked = () => [String(E.A), String(E.B)].join();
E.A = 0;
if (globalThis.leaked) throw new Error("stop");
E.B = 1;
