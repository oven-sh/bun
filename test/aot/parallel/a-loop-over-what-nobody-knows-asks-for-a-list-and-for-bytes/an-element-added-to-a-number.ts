// STATISTIC: LoopsBuiltForListsAndForBytes >= 3
// `s * x + c[i]`, `s += c[i]`, `1 + c[i] + ..`: the element is added to what an operator on numbers made, to what comes round the loop, to a written number. The `+` may join texts as well: it is a guess, and where texts come the front fails and the loop runs as it ran.
const key: string = JSON.parse('"go"');
const horner: Record<string, (c: any, x: number) => unknown> = { go(c: any, x: number): unknown { let s = 0; for (let i = 0; i < c.length; i++) s = s * x + c[i]; return s; } };
const sum: Record<string, (c: any) => unknown> = { go(c: any): unknown { let s: any = 0; for (let i = 0; i <= c.length; i++) s += c[i]; return s; } };
const long: Record<string, (c: any) => unknown> = { go(c: any): unknown { let s: any = 0; for (let i = 0; i < c.length; i++) s = 1 + c[i] + 2 + 3 + 4 + 5 + 6 + (s as number) * 0.5; return s; } };
const given: any[] = [JSON.parse("[1,2,3]"), JSON.parse("[0.5,1.5,-0]"), JSON.parse('["a","b"]'), JSON.parse('[1,"2",null,true]'), JSON.parse("[[1],[2]]"), [1, , 3], [], [1n, 2n], new Uint8Array([1, 2, 3]), Buffer.from([4, 5, 6]), new Float32Array([0.5, 1.5]), new Int16Array([-1, 2]), "abc", JSON.parse('{"length":2,"0":5,"1":"x"}'), [{ valueOf() { return 7; } }, { toString() { return "t"; } }]];
for (const c of given) for (let turn = 0; turn < 3; turn++) { let said: string; try { said = String(horner[key]!(c, 2)) + " | " + String(sum[key]!(c)) + " | " + String(long[key]!(c)); } catch (e) { said = (e as Error).name; } console.log(said); }
