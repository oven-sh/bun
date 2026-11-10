try {
  require("./bad.cjs");
} catch {}
const { old, kept } = globalThis;
console.log(old.children.length, kept.self.parent === old);
