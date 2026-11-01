exports.a = 1;
Bun.gc(true);
Bun.gc(true);
Object.defineProperty(exports, "young", { value: { fresh: [1, 2, 3].map(x => ({ x })) }, enumerable: true });
Object.defineProperty(exports, "getter", { get: (() => { const kept = { fresh: "kept" }; return function () { return kept; }; })(), enumerable: true });
const garbage = [];
for (let i = 0; i < 200000; i++) garbage.push({ i });
Bun.gc(false);
Bun.gc(true);
