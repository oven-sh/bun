// STATISTIC: LoopVersionsFailingIntoFallback >= 3
// The turn stores ints, so the list's copy asks in front for storage of ints. A list of halves is a list and fails that question: no turn has run, so it goes on to the copy of the rest and not into the closed copy.
const key: string = JSON.parse('"go"');
const T: Record<string, (c: any) => string> = { go(c: any): string { for (let i = 0; i < c.length; i++) c[i] = (c[i] + 1) & 127; return Array.prototype.join.call(c); } };
const given: any[] = [JSON.parse("[0.5,1.5,200.25]"), JSON.parse("[1,2,3]"), JSON.parse('["a",2]'), [1, , 3], Object.freeze([1, 2]), new Uint8Array([126, 127, 128]), Object.assign(new Uint8Array([1, 2]), { extra: 1 }), new Float64Array([0.5, 300.5])];
for (const c of given) for (let turn = 0; turn < 3; turn++) { let said: string; try { said = T[key]!(c); } catch (e) { said = (e as Error).name; } console.log(said); }
