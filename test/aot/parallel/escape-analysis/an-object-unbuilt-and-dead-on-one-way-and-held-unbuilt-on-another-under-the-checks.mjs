// Flags: --aot-verify-each-pass
// The inner object of the first literal is held on one way into the join and dead, in two shapes, on another. The analysis drops it there; the rewriting keeps it, because the join has it.
const launder = new Function("value", "return value");
const isEven = launder((n) => n % 2 === 0);
class Holder {
  scene(turn, ...rest) {
    const kept = turn % 2 === 0 ? { length: { deep: turn } } : isEven(turn) ? { _: undefined } : {};
    const wider = { ...kept, ...(process.platform !== "win32" ? { b: false } : {}) };
    const made = wider;
    return ["length" in made].join(" ");
  }
}
for (let turn = 0; turn < 3; turn++) console.log("scene", turn, new Holder().scene(turn));
