class A { constructor(...all) { this.t = all.join("-"); } }
const all = JSON.parse("[0]").map(() => A);
const out = [];
for (let i = 0; i < 4; i++) { try { out.push(Reflect.construct(all[0], [{ length: 2, 0: "a", 1: i }, "text", undefined, [i]][i]).t); } catch (e) { out.push(e.constructor.name + ": " + e.message); } }
for (let i = 0; i < 2; i++) { try { out.push(Reflect.construct(all[0]).t); } catch (e) { out.push(e.constructor.name); } }
console.log(out.join(" | "));
