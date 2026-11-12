try {
  require("./bad.cjs");
} catch {}
const old = globalThis.old;
const kept = globalThis.load();
console.log(old.children.length, old.children[0] === kept.self, kept.self.parent === old);
