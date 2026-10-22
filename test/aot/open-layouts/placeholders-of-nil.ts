interface Leaf { a: number; b: number; c: number; d: number; e: number; f: number; g: number; next: Leaf | undefined; }
interface Big { a: number; b: number; c: number; d: number; e: number; f: number; g: number; leaf: Leaf; }
interface Holder { state: Big; name: string; }
function makeLeaf(n: number): Leaf { return { a: n, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, next: undefined }; }
function makeBig(n: number): Big { return { a: n, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, leaf: makeLeaf(n) }; }
function sum(holder: Holder): number { return holder.state ? holder.state.a + holder.state.leaf.g : -1; }
const holders: Holder[] = [
    { state: undefined!, name: "undefined!" },
    { state: null!, name: "null!" },
    { state: undefined as any, name: "undefined as any" },
    { state: null as any, name: "null as any" },
    { state: undefined as unknown as Big, name: "undefined as unknown as Big" },
    { state: (void 0)!, name: "(void 0)!" },
    { state: (undefined as any)!, name: "(undefined as any)!" },
];
const cleared: Holder = { state: makeBig(1), name: "cleared by undefined!" };
cleared.state = undefined!;
const clearedAsAny: Holder = { state: makeBig(2), name: "cleared by null as any" };
clearedAsAny.state = null as any;
holders.push(cleared, clearedAsAny);
for (const holder of holders) console.log(holder.name, sum(holder), holder.state);
holders.forEach((holder, index) => { holder.state = makeBig(index); });
for (const holder of holders) console.log(holder.name, sum(holder), Object.keys(holder.state).join());
interface Control { control: number; }
const control: Control = JSON.parse('{"control":1}');
console.log(control.control);
