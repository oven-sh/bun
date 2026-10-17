// Variables of a module are stored to from functions, long after the module was evaluated: what they hold is new, they are not: a young collection finds it only if the store has told the collector.
declare const console: { log(...values: unknown[]): void };
declare function fullGC(): void;
declare function edenGC(): void;
class Box { constructor(public n: number, public label: string) {} }
let v0: Box | null = null;
let v1: number[] | null = null;
let v2: string = "";
let v3: (() => number) | null = null;
let v4: unknown = undefined;
let v5: Map<string, Box> | null = null;
let v6: Box | null = null;
let v7: number[] | null = null;
let v8: string = "";
let v9: (() => number) | null = null;
let v10: unknown = undefined;
let v11: Map<string, Box> | null = null;
let v12: Box | null = null;
let v13: number[] | null = null;
let v14: string = "";
let v15: (() => number) | null = null;
let v16: unknown = undefined;
let v17: Map<string, Box> | null = null;
let v18: Box | null = null;
let v19: number[] | null = null;
let v20: string = "";
let v21: (() => number) | null = null;
let v22: unknown = undefined;
let v23: Map<string, Box> | null = null;
let v24: Box | null = null;
let v25: number[] | null = null;
let v26: string = "";
let v27: (() => number) | null = null;
let v28: unknown = undefined;
let v29: Map<string, Box> | null = null;
let v30: Box | null = null;
let v31: number[] | null = null;
let v32: string = "";
let v33: (() => number) | null = null;
let v34: unknown = undefined;
let v35: Map<string, Box> | null = null;
let v36: Box | null = null;
let v37: number[] | null = null;
let v38: string = "";
let v39: (() => number) | null = null;
let v40: unknown = undefined;
let v41: Map<string, Box> | null = null;
let v42: Box | null = null;
let v43: number[] | null = null;
let v44: string = "";
let v45: (() => number) | null = null;
let v46: unknown = undefined;
let v47: Map<string, Box> | null = null;
let v48: Box | null = null;
let v49: number[] | null = null;
let v50: string = "";
let v51: (() => number) | null = null;
let v52: unknown = undefined;
let v53: Map<string, Box> | null = null;
let v54: Box | null = null;
let v55: number[] | null = null;
let v56: string = "";
let v57: (() => number) | null = null;
let v58: unknown = undefined;
let v59: Map<string, Box> | null = null;
let v60: Box | null = null;
let v61: number[] | null = null;
let v62: string = "";
let v63: (() => number) | null = null;
let v64: unknown = undefined;
let v65: Map<string, Box> | null = null;
let v66: Box | null = null;
let v67: number[] | null = null;
let v68: string = "";
let v69: (() => number) | null = null;
let v70: unknown = undefined;
let v71: Map<string, Box> | null = null;
let v72: Box | null = null;
let v73: number[] | null = null;
let v74: string = "";
let v75: (() => number) | null = null;
let v76: unknown = undefined;
let v77: Map<string, Box> | null = null;
let v78: Box | null = null;
let v79: number[] | null = null;
let v80: string = "";
let v81: (() => number) | null = null;
let v82: unknown = undefined;
let v83: Map<string, Box> | null = null;
let v84: Box | null = null;
let v85: number[] | null = null;
let v86: string = "";
let v87: (() => number) | null = null;
let v88: unknown = undefined;
let v89: Map<string, Box> | null = null;
let v90: Box | null = null;
let v91: number[] | null = null;
let v92: string = "";
let v93: (() => number) | null = null;
let v94: unknown = undefined;
let v95: Map<string, Box> | null = null;
export let exported: Box | null = null;
var hoisted: Box | undefined;
function store0(r: number): void { v0 = new Box(r + 0, "b" + r); v1 = [r, 1, r + 1]; v2 = "s" + r + "/2"; v3 = () => r + 3; v4 = r % 2 ? { r, i: 4 } : "u" + r; v5 = new Map([["k", new Box(r, "m5")]]); v6 = new Box(r + 6, "b" + r); v7 = [r, 7, r + 7]; v8 = "s" + r + "/8"; v9 = () => r + 9; v10 = r % 2 ? { r, i: 10 } : "u" + r; v11 = new Map([["k", new Box(r, "m11")]]); }
function store12(r: number): void { v12 = new Box(r + 12, "b" + r); v13 = [r, 13, r + 13]; v14 = "s" + r + "/14"; v15 = () => r + 15; v16 = r % 2 ? { r, i: 16 } : "u" + r; v17 = new Map([["k", new Box(r, "m17")]]); v18 = new Box(r + 18, "b" + r); v19 = [r, 19, r + 19]; v20 = "s" + r + "/20"; v21 = () => r + 21; v22 = r % 2 ? { r, i: 22 } : "u" + r; v23 = new Map([["k", new Box(r, "m23")]]); }
function store24(r: number): void { v24 = new Box(r + 24, "b" + r); v25 = [r, 25, r + 25]; v26 = "s" + r + "/26"; v27 = () => r + 27; v28 = r % 2 ? { r, i: 28 } : "u" + r; v29 = new Map([["k", new Box(r, "m29")]]); v30 = new Box(r + 30, "b" + r); v31 = [r, 31, r + 31]; v32 = "s" + r + "/32"; v33 = () => r + 33; v34 = r % 2 ? { r, i: 34 } : "u" + r; v35 = new Map([["k", new Box(r, "m35")]]); }
function store36(r: number): void { v36 = new Box(r + 36, "b" + r); v37 = [r, 37, r + 37]; v38 = "s" + r + "/38"; v39 = () => r + 39; v40 = r % 2 ? { r, i: 40 } : "u" + r; v41 = new Map([["k", new Box(r, "m41")]]); v42 = new Box(r + 42, "b" + r); v43 = [r, 43, r + 43]; v44 = "s" + r + "/44"; v45 = () => r + 45; v46 = r % 2 ? { r, i: 46 } : "u" + r; v47 = new Map([["k", new Box(r, "m47")]]); }
function store48(r: number): void { v48 = new Box(r + 48, "b" + r); v49 = [r, 49, r + 49]; v50 = "s" + r + "/50"; v51 = () => r + 51; v52 = r % 2 ? { r, i: 52 } : "u" + r; v53 = new Map([["k", new Box(r, "m53")]]); v54 = new Box(r + 54, "b" + r); v55 = [r, 55, r + 55]; v56 = "s" + r + "/56"; v57 = () => r + 57; v58 = r % 2 ? { r, i: 58 } : "u" + r; v59 = new Map([["k", new Box(r, "m59")]]); }
function store60(r: number): void { v60 = new Box(r + 60, "b" + r); v61 = [r, 61, r + 61]; v62 = "s" + r + "/62"; v63 = () => r + 63; v64 = r % 2 ? { r, i: 64 } : "u" + r; v65 = new Map([["k", new Box(r, "m65")]]); v66 = new Box(r + 66, "b" + r); v67 = [r, 67, r + 67]; v68 = "s" + r + "/68"; v69 = () => r + 69; v70 = r % 2 ? { r, i: 70 } : "u" + r; v71 = new Map([["k", new Box(r, "m71")]]); }
function store72(r: number): void { v72 = new Box(r + 72, "b" + r); v73 = [r, 73, r + 73]; v74 = "s" + r + "/74"; v75 = () => r + 75; v76 = r % 2 ? { r, i: 76 } : "u" + r; v77 = new Map([["k", new Box(r, "m77")]]); v78 = new Box(r + 78, "b" + r); v79 = [r, 79, r + 79]; v80 = "s" + r + "/80"; v81 = () => r + 81; v82 = r % 2 ? { r, i: 82 } : "u" + r; v83 = new Map([["k", new Box(r, "m83")]]); }
function store84(r: number): void { v84 = new Box(r + 84, "b" + r); v85 = [r, 85, r + 85]; v86 = "s" + r + "/86"; v87 = () => r + 87; v88 = r % 2 ? { r, i: 88 } : "u" + r; v89 = new Map([["k", new Box(r, "m89")]]); v90 = new Box(r + 90, "b" + r); v91 = [r, 91, r + 91]; v92 = "s" + r + "/92"; v93 = () => r + 93; v94 = r % 2 ? { r, i: 94 } : "u" + r; v95 = new Map([["k", new Box(r, "m95")]]); }
function storeOthers(r: number): void { exported = new Box(r, "exported"); hoisted = new Box(r, "hoisted"); }
function check(): number { return v0!.n + v0!.label.length + v1![0]! + v1![2]! + v1!.length + v2.length + v3!() + (typeof v4 === "string" ? (v4 as string).length : (v4 as { r: number; i: number }).r + (v4 as { r: number; i: number }).i) + v5!.get("k")!.n + v5!.get("k")!.label.length + v6!.n + v6!.label.length + v7![0]! + v7![2]! + v7!.length + v8.length + v9!() + (typeof v10 === "string" ? (v10 as string).length : (v10 as { r: number; i: number }).r + (v10 as { r: number; i: number }).i) + v11!.get("k")!.n + v11!.get("k")!.label.length + v12!.n + v12!.label.length + v13![0]! + v13![2]! + v13!.length + v14.length + v15!() + (typeof v16 === "string" ? (v16 as string).length : (v16 as { r: number; i: number }).r + (v16 as { r: number; i: number }).i) + v17!.get("k")!.n + v17!.get("k")!.label.length + v18!.n + v18!.label.length + v19![0]! + v19![2]! + v19!.length + v20.length + v21!() + (typeof v22 === "string" ? (v22 as string).length : (v22 as { r: number; i: number }).r + (v22 as { r: number; i: number }).i) + v23!.get("k")!.n + v23!.get("k")!.label.length + v24!.n + v24!.label.length + v25![0]! + v25![2]! + v25!.length + v26.length + v27!() + (typeof v28 === "string" ? (v28 as string).length : (v28 as { r: number; i: number }).r + (v28 as { r: number; i: number }).i) + v29!.get("k")!.n + v29!.get("k")!.label.length + v30!.n + v30!.label.length + v31![0]! + v31![2]! + v31!.length + v32.length + v33!() + (typeof v34 === "string" ? (v34 as string).length : (v34 as { r: number; i: number }).r + (v34 as { r: number; i: number }).i) + v35!.get("k")!.n + v35!.get("k")!.label.length + v36!.n + v36!.label.length + v37![0]! + v37![2]! + v37!.length + v38.length + v39!() + (typeof v40 === "string" ? (v40 as string).length : (v40 as { r: number; i: number }).r + (v40 as { r: number; i: number }).i) + v41!.get("k")!.n + v41!.get("k")!.label.length + v42!.n + v42!.label.length + v43![0]! + v43![2]! + v43!.length + v44.length + v45!() + (typeof v46 === "string" ? (v46 as string).length : (v46 as { r: number; i: number }).r + (v46 as { r: number; i: number }).i) + v47!.get("k")!.n + v47!.get("k")!.label.length + v48!.n + v48!.label.length + v49![0]! + v49![2]! + v49!.length + v50.length + v51!() + (typeof v52 === "string" ? (v52 as string).length : (v52 as { r: number; i: number }).r + (v52 as { r: number; i: number }).i) + v53!.get("k")!.n + v53!.get("k")!.label.length + v54!.n + v54!.label.length + v55![0]! + v55![2]! + v55!.length + v56.length + v57!() + (typeof v58 === "string" ? (v58 as string).length : (v58 as { r: number; i: number }).r + (v58 as { r: number; i: number }).i) + v59!.get("k")!.n + v59!.get("k")!.label.length + v60!.n + v60!.label.length + v61![0]! + v61![2]! + v61!.length + v62.length + v63!() + (typeof v64 === "string" ? (v64 as string).length : (v64 as { r: number; i: number }).r + (v64 as { r: number; i: number }).i) + v65!.get("k")!.n + v65!.get("k")!.label.length + v66!.n + v66!.label.length + v67![0]! + v67![2]! + v67!.length + v68.length + v69!() + (typeof v70 === "string" ? (v70 as string).length : (v70 as { r: number; i: number }).r + (v70 as { r: number; i: number }).i) + v71!.get("k")!.n + v71!.get("k")!.label.length + v72!.n + v72!.label.length + v73![0]! + v73![2]! + v73!.length + v74.length + v75!() + (typeof v76 === "string" ? (v76 as string).length : (v76 as { r: number; i: number }).r + (v76 as { r: number; i: number }).i) + v77!.get("k")!.n + v77!.get("k")!.label.length + v78!.n + v78!.label.length + v79![0]! + v79![2]! + v79!.length + v80.length + v81!() + (typeof v82 === "string" ? (v82 as string).length : (v82 as { r: number; i: number }).r + (v82 as { r: number; i: number }).i) + v83!.get("k")!.n + v83!.get("k")!.label.length + v84!.n + v84!.label.length + v85![0]! + v85![2]! + v85!.length + v86.length + v87!() + (typeof v88 === "string" ? (v88 as string).length : (v88 as { r: number; i: number }).r + (v88 as { r: number; i: number }).i) + v89!.get("k")!.n + v89!.get("k")!.label.length + v90!.n + v90!.label.length + v91![0]! + v91![2]! + v91!.length + v92.length + v93!() + (typeof v94 === "string" ? (v94 as string).length : (v94 as { r: number; i: number }).r + (v94 as { r: number; i: number }).i) + v95!.get("k")!.n + v95!.get("k")!.label.length + exported!.n + hoisted!.n; }
function litter(): number { let n = 0; for (let i = 0; i < 300; i++) n += [new Box(i, "litter" + i), { i }, "s" + i, [i, i]].length; return n; }
function storeAll(r: number): void { store0(r); store12(r); store24(r); store36(r); store48(r); store60(r); store72(r); store84(r); storeOthers(r); }
storeAll(0); fullGC(); fullGC();
let said = "";
for (let r = 1; r <= 24; r++) {
    if (r % 3) storeAll(r); else { store48(r); storeOthers(r); }
    edenGC(); litter(); said += check() + " ";
    if (r % 8 === 0) { fullGC(); litter(); said += check() + " "; }
}
console.log(said);
