const it = { [Symbol.iterator]() { return this }, next() { return { done: false, value: 1 } }, return() { new Proxy({}, { get() { return 1 } }).x; return {} } };
for (const v of it) throw new Error("boom");
