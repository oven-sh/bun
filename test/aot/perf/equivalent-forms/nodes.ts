// Three copies of one AST node constructor. Each has 32 node kinds, so the compiler does not inline the version that allocates by kind.
// NodeA is only constructed.
export interface NodeA { kind: number; posA: number; end: number; flags: number; parent: NodeA | undefined }
export interface A1 extends NodeA { kind: 1; ownA1: number }
export interface A2 extends NodeA { kind: 2; ownA2: number }
export interface A3 extends NodeA { kind: 3; ownA3: number }
export interface A4 extends NodeA { kind: 4; ownA4: number }
export interface A5 extends NodeA { kind: 5; ownA5: number }
export interface A6 extends NodeA { kind: 6; ownA6: number }
export interface A7 extends NodeA { kind: 7; ownA7: number }
export interface A8 extends NodeA { kind: 8; ownA8: number }
export interface A9 extends NodeA { kind: 9; ownA9: number }
export interface A10 extends NodeA { kind: 10; ownA10: number }
export interface A11 extends NodeA { kind: 11; ownA11: number }
export interface A12 extends NodeA { kind: 12; ownA12: number }
export interface A13 extends NodeA { kind: 13; ownA13: number }
export interface A14 extends NodeA { kind: 14; ownA14: number }
export interface A15 extends NodeA { kind: 15; ownA15: number }
export interface A16 extends NodeA { kind: 16; ownA16: number }
export interface A17 extends NodeA { kind: 17; ownA17: number }
export interface A18 extends NodeA { kind: 18; ownA18: number }
export interface A19 extends NodeA { kind: 19; ownA19: number }
export interface A20 extends NodeA { kind: 20; ownA20: number }
export interface A21 extends NodeA { kind: 21; ownA21: number }
export interface A22 extends NodeA { kind: 22; ownA22: number }
export interface A23 extends NodeA { kind: 23; ownA23: number }
export interface A24 extends NodeA { kind: 24; ownA24: number }
export interface A25 extends NodeA { kind: 25; ownA25: number }
export interface A26 extends NodeA { kind: 26; ownA26: number }
export interface A27 extends NodeA { kind: 27; ownA27: number }
export interface A28 extends NodeA { kind: 28; ownA28: number }
export interface A29 extends NodeA { kind: 29; ownA29: number }
export interface A30 extends NodeA { kind: 30; ownA30: number }
export interface A31 extends NodeA { kind: 31; ownA31: number }
export interface A32 extends NodeA { kind: 32; ownA32: number }
function NodeAObject(this: NodeA, kind: number, pos: number, end: number) {
  this.posA = pos;
  this.end = end;
  this.kind = kind;
  this.flags = 0;
  this.parent = undefined;
}
type MakerA = new (kind: number, pos: number, end: number) => NodeA;
const MakerOfA = NodeAObject as unknown as MakerA;
export function baseA(kind: number, pos: number): NodeA { return new MakerOfA(kind, pos, pos + 1); }
export function fillA(): number {
  let sum = 0;
  { const node = baseA(1, 1) as A1; node.ownA1 = 1; sum += node.ownA1; }
  { const node = baseA(2, 2) as A2; node.ownA2 = 2; sum += node.ownA2; }
  { const node = baseA(3, 3) as A3; node.ownA3 = 3; sum += node.ownA3; }
  { const node = baseA(4, 4) as A4; node.ownA4 = 4; sum += node.ownA4; }
  { const node = baseA(5, 5) as A5; node.ownA5 = 5; sum += node.ownA5; }
  { const node = baseA(6, 6) as A6; node.ownA6 = 6; sum += node.ownA6; }
  { const node = baseA(7, 7) as A7; node.ownA7 = 7; sum += node.ownA7; }
  { const node = baseA(8, 8) as A8; node.ownA8 = 8; sum += node.ownA8; }
  { const node = baseA(9, 9) as A9; node.ownA9 = 9; sum += node.ownA9; }
  { const node = baseA(10, 10) as A10; node.ownA10 = 10; sum += node.ownA10; }
  { const node = baseA(11, 11) as A11; node.ownA11 = 11; sum += node.ownA11; }
  { const node = baseA(12, 12) as A12; node.ownA12 = 12; sum += node.ownA12; }
  { const node = baseA(13, 13) as A13; node.ownA13 = 13; sum += node.ownA13; }
  { const node = baseA(14, 14) as A14; node.ownA14 = 14; sum += node.ownA14; }
  { const node = baseA(15, 15) as A15; node.ownA15 = 15; sum += node.ownA15; }
  { const node = baseA(16, 16) as A16; node.ownA16 = 16; sum += node.ownA16; }
  { const node = baseA(17, 17) as A17; node.ownA17 = 17; sum += node.ownA17; }
  { const node = baseA(18, 18) as A18; node.ownA18 = 18; sum += node.ownA18; }
  { const node = baseA(19, 19) as A19; node.ownA19 = 19; sum += node.ownA19; }
  { const node = baseA(20, 20) as A20; node.ownA20 = 20; sum += node.ownA20; }
  { const node = baseA(21, 21) as A21; node.ownA21 = 21; sum += node.ownA21; }
  { const node = baseA(22, 22) as A22; node.ownA22 = 22; sum += node.ownA22; }
  { const node = baseA(23, 23) as A23; node.ownA23 = 23; sum += node.ownA23; }
  { const node = baseA(24, 24) as A24; node.ownA24 = 24; sum += node.ownA24; }
  { const node = baseA(25, 25) as A25; node.ownA25 = 25; sum += node.ownA25; }
  { const node = baseA(26, 26) as A26; node.ownA26 = 26; sum += node.ownA26; }
  { const node = baseA(27, 27) as A27; node.ownA27 = 27; sum += node.ownA27; }
  { const node = baseA(28, 28) as A28; node.ownA28 = 28; sum += node.ownA28; }
  { const node = baseA(29, 29) as A29; node.ownA29 = 29; sum += node.ownA29; }
  { const node = baseA(30, 30) as A30; node.ownA30 = 30; sum += node.ownA30; }
  { const node = baseA(31, 31) as A31; node.ownA31 = 31; sum += node.ownA31; }
  { const node = baseA(32, 32) as A32; node.ownA32 = 32; sum += node.ownA32; }
  return sum;
}
// NodeC is also called as a plain function.
export interface NodeC { kind: number; posC: number; end: number; flags: number; parent: NodeC | undefined }
export interface C1 extends NodeC { kind: 1; ownC1: number }
export interface C2 extends NodeC { kind: 2; ownC2: number }
export interface C3 extends NodeC { kind: 3; ownC3: number }
export interface C4 extends NodeC { kind: 4; ownC4: number }
export interface C5 extends NodeC { kind: 5; ownC5: number }
export interface C6 extends NodeC { kind: 6; ownC6: number }
export interface C7 extends NodeC { kind: 7; ownC7: number }
export interface C8 extends NodeC { kind: 8; ownC8: number }
export interface C9 extends NodeC { kind: 9; ownC9: number }
export interface C10 extends NodeC { kind: 10; ownC10: number }
export interface C11 extends NodeC { kind: 11; ownC11: number }
export interface C12 extends NodeC { kind: 12; ownC12: number }
export interface C13 extends NodeC { kind: 13; ownC13: number }
export interface C14 extends NodeC { kind: 14; ownC14: number }
export interface C15 extends NodeC { kind: 15; ownC15: number }
export interface C16 extends NodeC { kind: 16; ownC16: number }
export interface C17 extends NodeC { kind: 17; ownC17: number }
export interface C18 extends NodeC { kind: 18; ownC18: number }
export interface C19 extends NodeC { kind: 19; ownC19: number }
export interface C20 extends NodeC { kind: 20; ownC20: number }
export interface C21 extends NodeC { kind: 21; ownC21: number }
export interface C22 extends NodeC { kind: 22; ownC22: number }
export interface C23 extends NodeC { kind: 23; ownC23: number }
export interface C24 extends NodeC { kind: 24; ownC24: number }
export interface C25 extends NodeC { kind: 25; ownC25: number }
export interface C26 extends NodeC { kind: 26; ownC26: number }
export interface C27 extends NodeC { kind: 27; ownC27: number }
export interface C28 extends NodeC { kind: 28; ownC28: number }
export interface C29 extends NodeC { kind: 29; ownC29: number }
export interface C30 extends NodeC { kind: 30; ownC30: number }
export interface C31 extends NodeC { kind: 31; ownC31: number }
export interface C32 extends NodeC { kind: 32; ownC32: number }
function NodeCObject(this: NodeC, kind: number, pos: number, end: number) {
  this.posC = pos;
  this.end = end;
  this.kind = kind;
  this.flags = 0;
  this.parent = undefined;
}
type MakerC = new (kind: number, pos: number, end: number) => NodeC;
const MakerOfC = NodeCObject as unknown as MakerC;
export function baseC(kind: number, pos: number): NodeC { return new MakerOfC(kind, pos, pos + 1); }
export function again(node: NodeC): NodeC { NodeCObject.call(node, node.kind, 7, 8); return node; }
export function fillC(): number {
  let sum = 0;
  { const node = baseC(1, 1) as C1; node.ownC1 = 1; sum += node.ownC1; }
  { const node = baseC(2, 2) as C2; node.ownC2 = 2; sum += node.ownC2; }
  { const node = baseC(3, 3) as C3; node.ownC3 = 3; sum += node.ownC3; }
  { const node = baseC(4, 4) as C4; node.ownC4 = 4; sum += node.ownC4; }
  { const node = baseC(5, 5) as C5; node.ownC5 = 5; sum += node.ownC5; }
  { const node = baseC(6, 6) as C6; node.ownC6 = 6; sum += node.ownC6; }
  { const node = baseC(7, 7) as C7; node.ownC7 = 7; sum += node.ownC7; }
  { const node = baseC(8, 8) as C8; node.ownC8 = 8; sum += node.ownC8; }
  { const node = baseC(9, 9) as C9; node.ownC9 = 9; sum += node.ownC9; }
  { const node = baseC(10, 10) as C10; node.ownC10 = 10; sum += node.ownC10; }
  { const node = baseC(11, 11) as C11; node.ownC11 = 11; sum += node.ownC11; }
  { const node = baseC(12, 12) as C12; node.ownC12 = 12; sum += node.ownC12; }
  { const node = baseC(13, 13) as C13; node.ownC13 = 13; sum += node.ownC13; }
  { const node = baseC(14, 14) as C14; node.ownC14 = 14; sum += node.ownC14; }
  { const node = baseC(15, 15) as C15; node.ownC15 = 15; sum += node.ownC15; }
  { const node = baseC(16, 16) as C16; node.ownC16 = 16; sum += node.ownC16; }
  { const node = baseC(17, 17) as C17; node.ownC17 = 17; sum += node.ownC17; }
  { const node = baseC(18, 18) as C18; node.ownC18 = 18; sum += node.ownC18; }
  { const node = baseC(19, 19) as C19; node.ownC19 = 19; sum += node.ownC19; }
  { const node = baseC(20, 20) as C20; node.ownC20 = 20; sum += node.ownC20; }
  { const node = baseC(21, 21) as C21; node.ownC21 = 21; sum += node.ownC21; }
  { const node = baseC(22, 22) as C22; node.ownC22 = 22; sum += node.ownC22; }
  { const node = baseC(23, 23) as C23; node.ownC23 = 23; sum += node.ownC23; }
  { const node = baseC(24, 24) as C24; node.ownC24 = 24; sum += node.ownC24; }
  { const node = baseC(25, 25) as C25; node.ownC25 = 25; sum += node.ownC25; }
  { const node = baseC(26, 26) as C26; node.ownC26 = 26; sum += node.ownC26; }
  { const node = baseC(27, 27) as C27; node.ownC27 = 27; sum += node.ownC27; }
  { const node = baseC(28, 28) as C28; node.ownC28 = 28; sum += node.ownC28; }
  { const node = baseC(29, 29) as C29; node.ownC29 = 29; sum += node.ownC29; }
  { const node = baseC(30, 30) as C30; node.ownC30 = 30; sum += node.ownC30; }
  { const node = baseC(31, 31) as C31; node.ownC31 = 31; sum += node.ownC31; }
  { const node = baseC(32, 32) as C32; node.ownC32 = 32; sum += node.ownC32; }
  return sum;
}
// NodeD is also registered as an exit handler, so native code calls it.
export interface NodeD { kind: number; posD: number; end: number; flags: number; parent: NodeD | undefined }
export interface D1 extends NodeD { kind: 1; ownD1: number }
export interface D2 extends NodeD { kind: 2; ownD2: number }
export interface D3 extends NodeD { kind: 3; ownD3: number }
export interface D4 extends NodeD { kind: 4; ownD4: number }
export interface D5 extends NodeD { kind: 5; ownD5: number }
export interface D6 extends NodeD { kind: 6; ownD6: number }
export interface D7 extends NodeD { kind: 7; ownD7: number }
export interface D8 extends NodeD { kind: 8; ownD8: number }
export interface D9 extends NodeD { kind: 9; ownD9: number }
export interface D10 extends NodeD { kind: 10; ownD10: number }
export interface D11 extends NodeD { kind: 11; ownD11: number }
export interface D12 extends NodeD { kind: 12; ownD12: number }
export interface D13 extends NodeD { kind: 13; ownD13: number }
export interface D14 extends NodeD { kind: 14; ownD14: number }
export interface D15 extends NodeD { kind: 15; ownD15: number }
export interface D16 extends NodeD { kind: 16; ownD16: number }
export interface D17 extends NodeD { kind: 17; ownD17: number }
export interface D18 extends NodeD { kind: 18; ownD18: number }
export interface D19 extends NodeD { kind: 19; ownD19: number }
export interface D20 extends NodeD { kind: 20; ownD20: number }
export interface D21 extends NodeD { kind: 21; ownD21: number }
export interface D22 extends NodeD { kind: 22; ownD22: number }
export interface D23 extends NodeD { kind: 23; ownD23: number }
export interface D24 extends NodeD { kind: 24; ownD24: number }
export interface D25 extends NodeD { kind: 25; ownD25: number }
export interface D26 extends NodeD { kind: 26; ownD26: number }
export interface D27 extends NodeD { kind: 27; ownD27: number }
export interface D28 extends NodeD { kind: 28; ownD28: number }
export interface D29 extends NodeD { kind: 29; ownD29: number }
export interface D30 extends NodeD { kind: 30; ownD30: number }
export interface D31 extends NodeD { kind: 31; ownD31: number }
export interface D32 extends NodeD { kind: 32; ownD32: number }
function NodeDObject(this: NodeD, kind: number, pos: number, end: number) {
  this.posD = pos;
  this.end = end;
  this.kind = kind;
  this.flags = 0;
  this.parent = undefined;
}
type MakerD = new (kind: number, pos: number, end: number) => NodeD;
const MakerOfD = NodeDObject as unknown as MakerD;
export function baseD(kind: number, pos: number): NodeD { return new MakerOfD(kind, pos, pos + 1); }
process.on("exit", NodeDObject as unknown as () => void);
export function fillD(): number {
  let sum = 0;
  { const node = baseD(1, 1) as D1; node.ownD1 = 1; sum += node.ownD1; }
  { const node = baseD(2, 2) as D2; node.ownD2 = 2; sum += node.ownD2; }
  { const node = baseD(3, 3) as D3; node.ownD3 = 3; sum += node.ownD3; }
  { const node = baseD(4, 4) as D4; node.ownD4 = 4; sum += node.ownD4; }
  { const node = baseD(5, 5) as D5; node.ownD5 = 5; sum += node.ownD5; }
  { const node = baseD(6, 6) as D6; node.ownD6 = 6; sum += node.ownD6; }
  { const node = baseD(7, 7) as D7; node.ownD7 = 7; sum += node.ownD7; }
  { const node = baseD(8, 8) as D8; node.ownD8 = 8; sum += node.ownD8; }
  { const node = baseD(9, 9) as D9; node.ownD9 = 9; sum += node.ownD9; }
  { const node = baseD(10, 10) as D10; node.ownD10 = 10; sum += node.ownD10; }
  { const node = baseD(11, 11) as D11; node.ownD11 = 11; sum += node.ownD11; }
  { const node = baseD(12, 12) as D12; node.ownD12 = 12; sum += node.ownD12; }
  { const node = baseD(13, 13) as D13; node.ownD13 = 13; sum += node.ownD13; }
  { const node = baseD(14, 14) as D14; node.ownD14 = 14; sum += node.ownD14; }
  { const node = baseD(15, 15) as D15; node.ownD15 = 15; sum += node.ownD15; }
  { const node = baseD(16, 16) as D16; node.ownD16 = 16; sum += node.ownD16; }
  { const node = baseD(17, 17) as D17; node.ownD17 = 17; sum += node.ownD17; }
  { const node = baseD(18, 18) as D18; node.ownD18 = 18; sum += node.ownD18; }
  { const node = baseD(19, 19) as D19; node.ownD19 = 19; sum += node.ownD19; }
  { const node = baseD(20, 20) as D20; node.ownD20 = 20; sum += node.ownD20; }
  { const node = baseD(21, 21) as D21; node.ownD21 = 21; sum += node.ownD21; }
  { const node = baseD(22, 22) as D22; node.ownD22 = 22; sum += node.ownD22; }
  { const node = baseD(23, 23) as D23; node.ownD23 = 23; sum += node.ownD23; }
  { const node = baseD(24, 24) as D24; node.ownD24 = 24; sum += node.ownD24; }
  { const node = baseD(25, 25) as D25; node.ownD25 = 25; sum += node.ownD25; }
  { const node = baseD(26, 26) as D26; node.ownD26 = 26; sum += node.ownD26; }
  { const node = baseD(27, 27) as D27; node.ownD27 = 27; sum += node.ownD27; }
  { const node = baseD(28, 28) as D28; node.ownD28 = 28; sum += node.ownD28; }
  { const node = baseD(29, 29) as D29; node.ownD29 = 29; sum += node.ownD29; }
  { const node = baseD(30, 30) as D30; node.ownD30 = 30; sum += node.ownD30; }
  { const node = baseD(31, 31) as D31; node.ownD31 = 31; sum += node.ownD31; }
  { const node = baseD(32, 32) as D32; node.ownD32 = 32; sum += node.ownD32; }
  return sum;
}
