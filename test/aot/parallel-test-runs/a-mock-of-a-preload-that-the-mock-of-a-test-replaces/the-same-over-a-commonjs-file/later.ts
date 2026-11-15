import * as all from "./lib.cjs";
export const names = () => Object.keys(all).sort().join("+");
const read = (name: string) => { try { return String((all as any)[name]); } catch { return "threw"; } };
export const values = () => [all.fn(), read("kept"), read("dropped"), read("added"), read("more")].join(" ");
