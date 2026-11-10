const show = all => (all.tell ? "ran" : typeof all.default + ":" + String(all.default).length);
const type = process.argv[2] ?? "text";
const first = await import("./part.js", { with: { type } });
const second = await import("./part.js?x", { with: { type } });
console.log(show(first), show(second), first === second);
