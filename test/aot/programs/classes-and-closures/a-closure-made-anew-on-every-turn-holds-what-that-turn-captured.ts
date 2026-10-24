// The closures that a loop makes anew on every turn capture strings, arrays, objects, big integers and other closures.
type ReadText = () => string;
type ReadList = () => number[];
type ReadPoint = () => { x: number };
function s1() { const makers: (() => ReadText)[] = []; const words = ["one", "two", "three"]; for (let i = 0; i < 3; i++) { const w = words[i] + "!"; makers.push(() => () => w); } const seen: string[] = []; for (const make of makers) seen.push(make()()); return seen; }
function s2() { const makers: (() => ReadList)[] = []; for (let i = 0; i < 3; i++) { const list = [i, i + 1]; makers.push(() => () => list); } const seen: number[] = []; for (const make of makers) seen.push(make()()[1]); return seen; }
function s3() { const makers: (() => ReadPoint)[] = []; for (let i = 0; i < 3; i++) { const point = { x: i }; makers.push(() => () => point); } const seen: number[] = []; for (const make of makers) seen.push(make()().x); return seen; }
function s4() { const makers: (() => () => unknown)[] = []; const things: unknown[] = ["a", { x: 1 }, [2]]; for (let i = 0; i < 3; i++) { const thing = things[i]; makers.push(() => () => thing); } const seen: string[] = []; for (const make of makers) seen.push(JSON.stringify(make()())); return seen; }
function s5() { const makers: (() => () => number)[] = []; for (let i = 0; i < 3; i++) { const half = i + 0.5; makers.push(() => () => half); } const seen: number[] = []; for (const make of makers) seen.push(make()()); return seen; }
function s6() { const makers: (() => () => bigint)[] = []; for (let i = 0; i < 3; i++) { const big = BigInt(i) * 10000000000000000000000n; makers.push(() => () => big); } const seen: string[] = []; for (const make of makers) seen.push(String(make()())); return seen; }
function s7() { const makers: (() => () => (() => number))[] = []; for (let i = 0; i < 3; i++) { const f = () => i * 3; makers.push(() => () => f); } const seen: number[] = []; for (const make of makers) seen.push(make()()()); return seen; }
function once() { return [s1(), s2(), s3(), s4(), s5(), s6(), s7()].map(String).join(" | "); }
console.log(once());
let last = "";
for (let turn = 0; turn < 200; turn++) last = once();
console.log(last);
