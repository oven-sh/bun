// A function that returns what another function returns hands a fresh object on in registers, as the function that makes it does.
// IR= 2 readsEitherOfTwo ResultAt
// IR= 0 readsEitherOfTwo PropGet|: =?L[0-9]+ = NewObject 
// IR= 2 readsForwardedOrMade ResultAt
// IR= 0 readsForwardedOrMade PropGet|: =?L[0-9]+ = NewObject 
// IR= 1 readsThroughThree ResultAt
// IR= 0 readsThroughThree PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 readsThroughOne PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 readsThroughTwo PropGet|: =?L[0-9]+ = NewObject 
// IR= 0 readsPair NewArray|ElemGet
type P = { x: number; y: number };
let noise = 0;
function pad(k: number): void { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
function pads(): void { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); pad(9); pad(10); pad(11); pad(12); }
function names(e: unknown): string { return ((e as Error).stack ?? "").split("\n").map(line => line.trim().replace(/^at /, "").split(/[ @(]/)[0]).filter(name => /^(first|second|viaOne|viaTwo|viaThree|forwardsOrMakes|eitherOfTwo|stacks)$/.test(name)).join(">"); }
function first(i: number): P { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (i === 1003) throw new Error("first"); return { x: i + noise, y: i * 2 }; }
function second(i: number): P { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i - noise, y: i * 3 }; }
function viaOne(i: number): P { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return first(i + 1); }
function viaTwo(i: number): P { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return viaOne(i + 1); }
function viaThree(i: number): P { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return viaTwo(i + 1); }
function forwardsOrMakes(i: number): P { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (i & 1) return first(i); return { x: i, y: -i }; }
function eitherOfTwo(i: number): P { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (i % 3) return first(i); return second(i); }
function pair(i: number): [number, number] { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return [i + noise, i * 5]; }
function viaPair(i: number): [number, number] { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return pair(i + 2); }
function maybe(i: number): P | undefined { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (i % 3 === 0) return undefined; return { x: i, y: noise }; }
function viaMaybe(i: number): P | undefined { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return maybe(i + 1); }
function inTry(i: number): P { pads(); try { return first(i); } finally { noise = (noise + 1) % 1000003; } }
function catches(i: number): P { pads(); try { return first(i); } catch { return { x: -1, y: -1 }; } }
function down(i: number, sum: number): P { if (i === 0) return { x: sum, y: i }; return down(i - 1, (sum + i) | 0); }
function even(i: number, sum: number): P { if (i === 0) return { x: sum, y: 0 }; return odd(i - 1, (sum + 1) | 0); }
function odd(i: number, sum: number): P { if (i === 0) return { x: sum, y: 1 }; return even(i - 1, (sum + 2) | 0); }
const kept: P[] = [];

function readsThroughOne(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const { x, y } = viaOne(i); t = (t + x + y) | 0; } return t; }
function readsThroughTwo(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = viaTwo(i); t = (t + p.x * 3 + p.y) | 0; } return t; }
function readsThroughThree(n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t + viaThree(i).y) | 0; return t; }
function readsForwardedOrMade(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const { x, y } = forwardsOrMakes(i); t = (t + x - y) | 0; } return t; }
function readsEitherOfTwo(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const { x, y } = eitherOfTwo(i); t = (t + x + y) | 0; } return t; }
function readsPair(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const [a, b] = viaPair(i); t = (t + a + b) | 0; } return t; }

function keepsThroughTwo(n: number): number { for (let i = 0; i < n; i++) kept.push(viaTwo(i)); let t = 0; for (const p of kept) t = (t + p.x + p.y) | 0; return t + kept.length; }
function comparesIdentity(): string { const a = viaTwo(1); const b = viaTwo(1); const c = a; return [a === b, a === c, a !== b, Object.is(a, c)].join(); }
function writesToResult(): number { const p = viaOne(4); p.x = 9; p.y += 1; return p.x + p.y; }
function usedAsValue(): string { return [1, 2, 3].map(viaOne).map(p => p.y).join() + ";" + [4, 5].map(eitherOfTwo).map(p => typeof p.x).join(); }
function calledThroughVariable(flag: boolean): number { const f = flag ? viaOne : viaTwo; return f(7).y; }
function readsMaybe(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const p = viaMaybe(i); t = (t + (p ? p.x : -7)) | 0; } return t; }
function throughTry(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const { x, y } = inTry(i); t = (t + x + y) | 0; } return t; }
function throughCatch(): string { return [catches(5).y, catches(1003).y].join(); }
function stacks(): string { const out: string[] = []; for (const f of [() => viaOne(1002).x, () => viaTwo(1001).x, () => viaThree(1000).x, () => forwardsOrMakes(1003).x, () => eitherOfTwo(1003).x]) { try { out.push("" + f()); } catch (e) { out.push(names(e)); } } return out.join(" | "); }
function deep(): string { return [down(200000, 0).x, even(200001, 0).y, even(200000, 0).x].join(); }
function enumerated(): string { return Object.keys(viaTwo(2)).join() + JSON.stringify(viaPair(0).length) + Array.isArray(viaPair(1)); }

console.log(readsThroughOne(30), readsThroughTwo(30), readsThroughThree(30), readsForwardedOrMade(30), readsEitherOfTwo(30), readsPair(30));
console.log(keepsThroughTwo(10), comparesIdentity(), writesToResult(), usedAsValue(), calledThroughVariable(true), calledThroughVariable(false));
console.log(readsMaybe(20), throughTry(10), throughCatch());
console.log(stacks());
console.log(deep());
console.log(enumerated());
