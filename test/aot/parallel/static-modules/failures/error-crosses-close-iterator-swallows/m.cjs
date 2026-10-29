const it = { [Symbol.iterator]() { return this }, next() { return { done: false, value: 1 } }, return() { try { null.x } catch {} return {} } };
for (const v of it) throw new Error("boom");
