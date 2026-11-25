import written from "./part.js?x" with { type: "text" };
const show = all => (all.tell ? "ran" : typeof all.default + ":" + String(all.default).length);
const type = process.argv[2] ?? "text";
const all = await import("./part.js?x", { with: { type } });
console.log(typeof written, show(all), all.default === written);
