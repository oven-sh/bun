// STATISTIC: StringForOfLoopsVersioned = 1
// No call changes a text: the copy that steps over texts goes on behind the call.
const ranges: readonly (readonly [number, number])[] = [[0x300, 0x36f], [0x200b, 0x200f], [0xfe00, 0xfe0f]];
function indexed(code: number, list: readonly (readonly [number, number])[]): boolean { for (let i = 0; i < list.length; i++) if (code >= list[i]![0] && code <= list[i]![1]) return true; return false; }
function width(text: string): number { let w = 0; for (const c of text) { const code = c.codePointAt(0)!; if (code <= 0x1f) continue; if (code > 0x2ff && indexed(code, ranges)) continue; w += code > 0x10ff ? 2 : 1; } return w; }
const N = 40;
const lists = ["\u0300 \ud800 half", "", "the quick brown fox jumps over the lazy dog and runs away from here to the far end of the road", "another te\u0301xt \u{1F600} that is exactly as long as the first one was, or nearly so, give or take a few words"];
(globalThis as any).texts = lists;
function pick(t: number): any { return (globalThis as any).texts[t & 3]; }
let sum = 0;
for (let t = 0; t < N; t++) sum = (sum + width(pick(t) as string)) | 0;
console.log(sum);
