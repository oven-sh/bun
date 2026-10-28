export let calls = 0;
export function Counted(Parent) { calls++; return class extends Parent { #c = calls; static has(o) { return #c in o; } get c() { return this.#c; } static maker = Counted; }; }
export const Arrow = (Parent) => class extends Parent { static n = ++calls; };
export default function (Parent) { return class extends Parent { who() { return "default>" + super.who(); } }; }
export { Counted as Renamed };
export class Base { who() { return "base"; } }
export const Inside1 = Counted(Base), Inside2 = Counted(Base);
