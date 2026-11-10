class P { constructor(x) { this.x = x; } m() {} }
const out = [];
for (const target of [() => 1, new P(1).m, 5, null, {}, async function () {}, function* () {}, Math.max]) { try { out.push(typeof Reflect.construct(target, [1])); } catch (e) { out.push(e.name + ": " + e.message); } }
console.log(out.join(" | "));
