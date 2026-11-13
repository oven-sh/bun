const show = all => (all.tell ? "ran" : typeof all.default + ":" + String(all.default).length);
const type = process.argv[2] ?? "text";
const code = await import("./part.js?x");
const text = await import("./part.js?x", { with: { type } });
console.log(show(code), show(text));
