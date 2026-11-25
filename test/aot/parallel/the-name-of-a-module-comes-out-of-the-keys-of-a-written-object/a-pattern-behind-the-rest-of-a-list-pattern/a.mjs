let kept;
const [...[first]] = (kept = [{ path: "./b.mjs" }]);
first.path = "./c.mjs";
export async function load() { return (await import(kept[0].path)).name; }
