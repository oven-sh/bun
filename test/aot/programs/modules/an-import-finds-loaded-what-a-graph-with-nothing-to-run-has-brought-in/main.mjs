let turns = 0, done = false;
(async () => { while (!done) { turns++; await null; } })();
const a = await import("./a.mjs"); console.log("a", turns);
const c = await import("./c.mjs"); console.log("c", turns);
const e = await import("./e.mjs"); console.log("e", turns);
done = true;
console.log(a.a() + c.c() + e.e());
