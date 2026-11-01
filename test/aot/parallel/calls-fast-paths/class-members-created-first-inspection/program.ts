declare const console: any; declare function generateHeapSnapshot(): any; declare function gc(): void;
const kinds = ["Function", "NativeExecutable", "Structure", "GetterSetter"];
let before: number[] = [0, 0, 0, 0];
// THE COUNT LEAVES NO TRACE IN WHAT IT COUNTS: the first version tallied every class name in a plain record: each name met for the first time gave the record another Structure, in whichever snapshot it first showed: five of them moved from the fourth census to the second
// with a landing that had nothing to do with classes (6 + 2 for 1 + 7). Now: the four kinds, in an array, by loops: no record, no closure.
function census(label: string): void {
    gc(); gc(); const s = generateHeapSnapshot(); const names: string[] = s.nodeClassNames; const nodes: number[] = s.nodes; const now: number[] = [0, 0, 0, 0];
    for (let i = 0; i < nodes.length; i += 4) { const n = names[nodes[i + 2]]; for (let k = 0; k < 4; k++) if (n === kinds[k]) now[k]++; }
    let line = label + ":"; for (let k = 0; k < 4; k++) line += (k ? ", " : " ") + kinds[k] + " +" + (now[k] - before[k]);
    if (label) console.log(line);
    before = now;
}
class A { constructor(public v: number) {} m1(): number { return this.v; } m2(): number { return 2; } m3(): number { return 3; } m4(): number { return 4; } m5(): number { return 5; } m6(): number { return 6; } m7(): number { return 7; } m8(): number { return 8; } get g1(): number { return 1; } get g2(): number { return 2; } static s1(): number { return 1; } static s2(): number { return 2; } }
class B extends A { n1(): number { return 1; } n2(): number { return 2; } n3(): number { return 3; } n4(): number { return 4; } }
class C { constructor(public v: number) {} m1(): number { return this.v; } m2(): number { return 2; } m3(): number { return 3; } m4(): number { return 4; } }
console.log("heap cells of four kinds, more than at the line before"); census(""); census(""); census(""); census("nothing happened");
// The objects stay reachable. A dead one is seen or not as a word left in a frame will have it, and what the snapshot sees it looks at.
const kept: object[] = [];
const c = new C(3); kept.push(c); let s = c.m1() + c.m2() + c.m3() + c.m4();
census("new C and four typed calls");
census("the snapshot has looked at C");
const b = new B(2); kept.push(b); s += b.n1() + b.m1() + b.g1;
census("new B extends A and three typed calls");
census("the snapshot has looked at B and A");
const a = new A(1); kept.push(a); s += a.m1() + A.s1();
census("new A");
console.log(s, kept.length);
export {};
