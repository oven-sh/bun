// A captured variable holds a text, a list and nothing in turn, is read by key and by its length, and is changed by a call in the turn.
function holder() {
  let text = "";
  let any: string | number[] | undefined = "";
  let reads = 0;
  return {
    set(t: string): void { text = t; },
    put(v: string | number[] | undefined): void { any = v; },
    count(mark: string): number { let n = 0; for (let i = 0; i < text.length; i++) if (text[i] === mark) n++; return n; },
    changing(): string { let s = ""; for (let i = 0; i < text.length; i++) { s += text[i]; if (i === 2) { reads++; text = text + "!".repeat(reads & 1); } } return s; },
    lengths(): number { let s = 0; for (let i = 0; any !== undefined && i < any.length; i++) s += any.length * 2 + (typeof any === "string" ? 1 : any[i]!); return s; },
    nested(): number { let s = 0; for (let i = 0; i < text.length; i++) { while (i < text.length && text.charCodeAt(i) === 32) i++; s = s * 3 + i; } return s % 1000003; },
  };
}
const h = holder(), out: string[] = [];
for (let t = 0; t < 40; t++) {
  h.set(["", " a b", "a-b-c  ", "\u0416-\u0416 x"][t % 4]!);
  h.put([undefined, "abc", [1, 2, 3.5], "", []][t % 5] as string | number[] | undefined);
  out.push(h.count("-") + "," + h.changing() + "," + h.lengths() + "," + h.nested());
}
console.log(out.join("|"));
// @ts-expect-error The loop runs in the dead zone of the variable: that is what is asked.
(() => { try { (() => { let s = 0; for (let i = 0; i < 2; i++) s += late.length; return s; })(); } catch (e) { console.log((e as Error).name); } let late = "x"; console.log(late.length); })();
export {};
