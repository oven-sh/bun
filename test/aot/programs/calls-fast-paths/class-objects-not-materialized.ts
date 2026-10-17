// Counts heap cells to show that a class object that nothing has inspected takes a single cell.
// ENV JSC_seedOfVMRandomForFuzzer=1
declare const console: any; declare function memoryUsageStatistics(): any;
const holders: any[] = [];
const kinds = ["Function", "Structure", "PropertyTable", "Object"];
let before = memoryUsageStatistics().objectTypeCounts;
function census(label: string): void { const now = memoryUsageStatistics().objectTypeCounts; let line = label + ": "; for (let i = 0; i < kinds.length; i++) line += (i ? ", " : "") + kinds[i] + " " + ((now[kinds[i]] || 0) - (before[kinds[i]] || 0)); console.log(line); before = now; }
class C0 { x0 = 0; m0(a: number): number { return a + this.x0; } n0(): number { return 0; } }
class C1 { x1 = 1; m1(a: number): number { return a + this.x1; } n1(): number { return 1; } }
class C2 { x2 = 2; m2(a: number): number { return a + this.x2; } n2(): number { return 2; } }
class C3 { x3 = 3; m3(a: number): number { return a + this.x3; } n3(): number { return 3; } }
class C4 { x4 = 4; m4(a: number): number { return a + this.x4; } n4(): number { return 4; } }
class C5 { x5 = 5; m5(a: number): number { return a + this.x5; } n5(): number { return 5; } }
class C6 { x6 = 6; m6(a: number): number { return a + this.x6; } n6(): number { return 6; } }
class C7 { x7 = 7; m7(a: number): number { return a + this.x7; } n7(): number { return 7; } }
class C8 { x8 = 8; m8(a: number): number { return a + this.x8; } n8(): number { return 8; } }
class C9 { x9 = 9; m9(a: number): number { return a + this.x9; } n9(): number { return 9; } }
class C10 { x10 = 10; m10(a: number): number { return a + this.x10; } n10(): number { return 10; } }
class C11 { x11 = 11; m11(a: number): number { return a + this.x11; } n11(): number { return 11; } }
class C12 { x12 = 12; m12(a: number): number { return a + this.x12; } n12(): number { return 12; } }
class C13 { x13 = 13; m13(a: number): number { return a + this.x13; } n13(): number { return 13; } }
class C14 { x14 = 14; m14(a: number): number { return a + this.x14; } n14(): number { return 14; } }
class C15 { x15 = 15; m15(a: number): number { return a + this.x15; } n15(): number { return 15; } }
class C16 { x16 = 16; m16(a: number): number { return a + this.x16; } n16(): number { return 16; } }
class C17 { x17 = 17; m17(a: number): number { return a + this.x17; } n17(): number { return 17; } }
class C18 { x18 = 18; m18(a: number): number { return a + this.x18; } n18(): number { return 18; } }
class C19 { x19 = 19; m19(a: number): number { return a + this.x19; } n19(): number { return 19; } }
class C20 { x20 = 20; m20(a: number): number { return a + this.x20; } n20(): number { return 20; } }
class C21 { x21 = 21; m21(a: number): number { return a + this.x21; } n21(): number { return 21; } }
class C22 { x22 = 22; m22(a: number): number { return a + this.x22; } n22(): number { return 22; } }
class C23 { x23 = 23; m23(a: number): number { return a + this.x23; } n23(): number { return 23; } }
class C24 { x24 = 24; m24(a: number): number { return a + this.x24; } n24(): number { return 24; } }
class C25 { x25 = 25; m25(a: number): number { return a + this.x25; } n25(): number { return 25; } }
class C26 { x26 = 26; m26(a: number): number { return a + this.x26; } n26(): number { return 26; } }
class C27 { x27 = 27; m27(a: number): number { return a + this.x27; } n27(): number { return 27; } }
class C28 { x28 = 28; m28(a: number): number { return a + this.x28; } n28(): number { return 28; } }
class C29 { x29 = 29; m29(a: number): number { return a + this.x29; } n29(): number { return 29; } }
class C30 { x30 = 30; m30(a: number): number { return a + this.x30; } n30(): number { return 30; } }
class C31 { x31 = 31; m31(a: number): number { return a + this.x31; } n31(): number { return 31; } }
class C32 { x32 = 32; m32(a: number): number { return a + this.x32; } n32(): number { return 32; } }
class C33 { x33 = 33; m33(a: number): number { return a + this.x33; } n33(): number { return 33; } }
class C34 { x34 = 34; m34(a: number): number { return a + this.x34; } n34(): number { return 34; } }
class C35 { x35 = 35; m35(a: number): number { return a + this.x35; } n35(): number { return 35; } }
class C36 { x36 = 36; m36(a: number): number { return a + this.x36; } n36(): number { return 36; } }
class C37 { x37 = 37; m37(a: number): number { return a + this.x37; } n37(): number { return 37; } }
class C38 { x38 = 38; m38(a: number): number { return a + this.x38; } n38(): number { return 38; } }
class C39 { x39 = 39; m39(a: number): number { return a + this.x39; } n39(): number { return 39; } }
class C40 extends C0 { x40 = 40; m40(a: number): number { return a + this.x40; } n40(): number { return 40; } }
class C41 extends C1 { x41 = 41; m41(a: number): number { return a + this.x41; } n41(): number { return 41; } }
class C42 extends C2 { x42 = 42; m42(a: number): number { return a + this.x42; } n42(): number { return 42; } }
class C43 extends C3 { x43 = 43; m43(a: number): number { return a + this.x43; } n43(): number { return 43; } }
class C44 extends C4 { x44 = 44; m44(a: number): number { return a + this.x44; } n44(): number { return 44; } }
class C45 extends C5 { x45 = 45; m45(a: number): number { return a + this.x45; } n45(): number { return 45; } }
class C46 extends C6 { x46 = 46; m46(a: number): number { return a + this.x46; } n46(): number { return 46; } }
class C47 extends C7 { x47 = 47; m47(a: number): number { return a + this.x47; } n47(): number { return 47; } }
class C48 extends C8 { x48 = 48; m48(a: number): number { return a + this.x48; } n48(): number { return 48; } }
class C49 extends C9 { x49 = 49; m49(a: number): number { return a + this.x49; } n49(): number { return 49; } }
class C50 extends C10 { x50 = 50; m50(a: number): number { return a + this.x50; } n50(): number { return 50; } }
class C51 extends C11 { x51 = 51; m51(a: number): number { return a + this.x51; } n51(): number { return 51; } }
class C52 extends C12 { x52 = 52; m52(a: number): number { return a + this.x52; } n52(): number { return 52; } }
class C53 extends C13 { x53 = 53; m53(a: number): number { return a + this.x53; } n53(): number { return 53; } }
class C54 extends C14 { x54 = 54; m54(a: number): number { return a + this.x54; } n54(): number { return 54; } }
class C55 extends C15 { x55 = 55; m55(a: number): number { return a + this.x55; } n55(): number { return 55; } }
class C56 extends C16 { x56 = 56; m56(a: number): number { return a + this.x56; } n56(): number { return 56; } }
class C57 extends C17 { x57 = 57; m57(a: number): number { return a + this.x57; } n57(): number { return 57; } }
class C58 extends C18 { x58 = 58; m58(a: number): number { return a + this.x58; } n58(): number { return 58; } }
class C59 extends C19 { x59 = 59; m59(a: number): number { return a + this.x59; } n59(): number { return 59; } }
census("declared");
holders.push(C0); holders.push(C1); holders.push(C2); holders.push(C3); holders.push(C4); holders.push(C5); holders.push(C6); holders.push(C7); holders.push(C8); holders.push(C9); holders.push(C10); holders.push(C11); holders.push(C12); holders.push(C13); holders.push(C14); holders.push(C15); holders.push(C16); holders.push(C17); holders.push(C18); holders.push(C19); holders.push(C20); holders.push(C21); holders.push(C22); holders.push(C23); holders.push(C24); holders.push(C25); holders.push(C26); holders.push(C27); holders.push(C28); holders.push(C29); holders.push(C30); holders.push(C31); holders.push(C32); holders.push(C33); holders.push(C34); holders.push(C35); holders.push(C36); holders.push(C37); holders.push(C38); holders.push(C39); holders.push(C40); holders.push(C41); holders.push(C42); holders.push(C43); holders.push(C44); holders.push(C45); holders.push(C46); holders.push(C47); holders.push(C48); holders.push(C49); holders.push(C50); holders.push(C51); holders.push(C52); holders.push(C53); holders.push(C54); holders.push(C55); holders.push(C56); holders.push(C57); holders.push(C58); holders.push(C59);
census("60 classes as values");
let n = 0;
for (const C of holders) n += (C.displayName === undefined ? 1 : 0) + (C.$$typeof === undefined ? 1 : 0) + ("nothing" in C ? 0 : 1) + (typeof C.call === "function" ? 1 : 0) + (typeof C === "function" ? 1 : 0);
census("looked for what they have not, and for what they inherit");
const seen = new Map<any, number>(); for (const C of holders) seen.set(C, 1); for (const C of holders) n += seen.get(C)!;
census("kept as keys");
const objects: any[] = holders.map(C => new C());
census("new C through the value");
for (let i = 0; i < 60; i++) n += objects[i]["n" + i]() === i ? 1 : 0;
census("a method of each, by name");
for (let i = 0; i < 60; i++) n += objects[i].constructor === holders[i] ? 1 : 0;
census("o.constructor");
for (let i = 0; i < 30; i++) n += typeof holders[i].prototype === "object" ? 1 : 0;
census("C.prototype of 30");
for (let i = 30; i < 45; i++) n += holders[i].name.length;
census("C.name of 15 more");
for (let i = 45; i < 60; i++) holders[i].added = i;
census("a store to the last 15");
for (let i = 0; i < 60; i++) n += (typeof holders[i].prototype === "object" ? 1 : 0) + holders[i].name.length;
census("all of it again");
console.log(n);
export {};
