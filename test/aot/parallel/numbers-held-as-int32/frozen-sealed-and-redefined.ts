// frozen sealed and redefined
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const said: string[] = [];
const frozen = Object.freeze(new Range(1, 3)); (globalThis as any).kept = frozen;
try { (frozen as any).pos = hidden<number>("2.5"); said.push("stored"); } catch (e) { said.push((e as Error).constructor.name); }
said.push(String(frozen.pos), cut("abcdef", frozen));
const sealed = Object.seal(new Range(1, 3)); sealed.pos = hidden<number>("2.5"); said.push(String(sealed.pos), cut("abcdef", sealed));
const got = new Range(1, 3); let reads = 0; Object.defineProperty(got, "pos", { get() { reads++; return 2; }, configurable: true }); said.push(cut("abcdef", got), String(reads));
const fixed = new Range(1, 3); Object.defineProperty(fixed, "pos", { value: 0.5, writable: false }); try { fixed.pos = 2; said.push("stored"); } catch (e) { said.push((e as Error).constructor.name); } said.push(String(fixed.pos));
console.log(said.join(" | "));
