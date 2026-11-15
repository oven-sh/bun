import { base } from "./dep.mjs";
export class E { static n = 1; run(code) { return eval(code); } static run(code) { return eval(code); } }
{ let hidden = base + 1; const direct = code => eval(code); globalThis.direct = direct; globalThis.readHidden = () => hidden; }
export function use() { const e = new E(); let out = [e.run("E.n"), E.run("E.n++"), E.run("typeof this"), globalThis.direct("hidden"), globalThis.direct("hidden = 9"), globalThis.readHidden()]; return out.join(" "); }
