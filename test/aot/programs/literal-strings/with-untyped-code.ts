// Objects with fields written as a union of string literals cross to untyped code and back. A string outside the union that untyped code stores stays in the field, and untyped and typed code read it back as it is.
import { read, write, make, echo, keys } from "./with-untyped-code-helper.js";
type Mode = "on" | "off" | "auto";
interface Switch { mode: Mode; name: string; fallback?: Mode }

function create(mode: Mode): Switch {
    return { mode, name: "s-" + mode };
}
function isOn(s: Switch): boolean {
    return s.mode === "on";
}
function number(m: Mode): number {
    return m === "on" ? 1 : m === "off" ? 0 : m === "auto" ? 2 : -1;
}
function attempt(f: () => unknown): unknown {
    try { return f(); } catch (e) { return (e as Error).constructor.name; }
}
const a: Switch = create("on");
const b: Switch = create("auto");
console.log(read(a), read(b), keys(a), isOn(a), isOn(b));
write(a, "off");
write(b, "o" + "n");
console.log(a.mode, b.mode, isOn(a), isOn(b), number(a.mode), number(b.mode));
write(a, "unheard of");
console.log(attempt(() => a.mode), attempt(() => number(a.mode)), attempt(() => isOn(a)), read(a), JSON.stringify(a));
const made = make("auto") as Switch;
console.log(made.mode, number(made.mode), isOn(made));
const back = echo(b.mode) as Mode;
console.log(back, number(back), back === b.mode);
a.fallback = back;
console.log(read(a), a.fallback, keys(a));
