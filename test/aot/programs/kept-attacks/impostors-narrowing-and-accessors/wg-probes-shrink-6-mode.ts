// Impostors narrowing and accessors: wg probes shrink  mode. It prints what plain Bun prints.
class Switch {
  mode: "on" | "off" = "on";
}

function cost(s: Switch): number {
  return s.mode === "on" ? 10 : 20;
}

const s = new Switch();
Object.assign(s, { mode: "off" });
console.log(cost(s), s.mode);
