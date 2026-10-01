interface W { a?: number; b?: string }
declare let w: W; declare let nw: { c: number };
w = nw;
declare let fn: () => { a: number }; w = fn;
declare let sObj: String; let sPrim: string = sObj;
declare let O: Object; let xx: { a: number } = O;
class P1 { private x = 1 } class P2 { private x = 1 }
let p1: P1 = new P2();
function tp<T>(x: T) { let y: string = x; let z: T = "s"; }
function tp2<T extends string>(x: T) { let z: T = "s"; }
declare let idx1: { [k: string]: number }; declare let idx2: { a: string };
idx1 = idx2;
declare let idx3: { [k: string]: string }; idx1 = idx3;
declare let opt1: { a: number }; declare let opt2: { a?: number }; opt1 = opt2;
declare let miss: { a: number; b: number; c: number }; miss = {};
declare let miss6: { a: number; b: number; c: number; d: number; e: number; f: number }; declare let em: { z: 1 }; miss6 = em;
declare let ro: { readonly a: number }; declare let tl: `a${string}`; tl = "b";
declare let nn: string; declare let un0: string | undefined; nn = un0;
