// The same element under written indexes read twice and more, of lists of either kind, with holes and too short, beside numbers and texts.
// STATISTIC: ListsGuardedForReads >= 4
class Matrix0 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply0(m: Matrix0, k: any): any { const e = m.e as any as number[]; return e[4] + e[0] - k + e[0] * k; }
console.log(apply0(new Matrix0([1, 1, 3, 1, 2]), 2));
console.log(apply0(new Matrix0([]), 2));
console.log(apply0(new Matrix0([1, , 3] as any), "q"));
console.log(apply0(new Matrix0([1, 1, 3, 1, 2]), 0.5));
class Matrix1 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply1(m: Matrix1, k: any): any { const e = m.e as any as number[]; return e[4] + e[0] - k + e[0] * k; }
console.log(apply1(new Matrix1([0.5, 1.5, 2.5, 3.5, 4.5]), 2));
console.log(apply1(new Matrix1([0.5]), 2));
console.log(apply1(new Matrix1([, 1.5, , , 2] as any), "q"));
console.log(apply1(new Matrix1([0.5, 1.5, 2.5, 3.5, 4.5]), 0.5));
class Matrix2 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply2(m: Matrix2, k: any): any { const e = m.e as any as number[]; return e[4] + e[0] + e[0] * 2; }
console.log(apply2(new Matrix2([1, 1, 3, 1, 2]), 2));
console.log(apply2(new Matrix2([]), 2));
console.log(apply2(new Matrix2([1, , 3] as any), "q"));
console.log(apply2(new Matrix2([1, 1, 3, 1, 2]), 0.5));
class Matrix3 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply3(m: Matrix3, k: any): any { const e = m.e as any as number[]; return e[4] + e[0] + e[0] * 2; }
console.log(apply3(new Matrix3([0.5, 1.5, 2.5, 3.5, 4.5]), 2));
console.log(apply3(new Matrix3([0.5]), 2));
console.log(apply3(new Matrix3([, 1.5, , , 2] as any), "q"));
console.log(apply3(new Matrix3([0.5, 1.5, 2.5, 3.5, 4.5]), 0.5));
class Matrix4 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply4(m: Matrix4, k: any): any { const e = m.e as any as number[]; return e[4] * 2 + e[0] * 2 + e[0] * 3 - e[4]; }
console.log(apply4(new Matrix4([1, 1, 3, 1, 2]), 2));
console.log(apply4(new Matrix4([]), 2));
console.log(apply4(new Matrix4([1, , 3] as any), "q"));
console.log(apply4(new Matrix4([1, 1, 3, 1, 2]), 0.5));
class Matrix5 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply5(m: Matrix5, k: any): any { const e = m.e as any as number[]; return e[4] * 2 + e[0] * 2 + e[0] * 3 - e[4]; }
console.log(apply5(new Matrix5([0.5, 1.5, 2.5, 3.5, 4.5]), 2));
console.log(apply5(new Matrix5([0.5]), 2));
console.log(apply5(new Matrix5([, 1.5, , , 2] as any), "q"));
console.log(apply5(new Matrix5([0.5, 1.5, 2.5, 3.5, 4.5]), 0.5));
class Matrix6 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply6(m: Matrix6, k: any): any { const e = m.e as any as number[]; return (e[4] + e[0]) * (e[0] + e[1]); }
console.log(apply6(new Matrix6([1, 1, 3, 1, 2]), 2));
console.log(apply6(new Matrix6([]), 2));
console.log(apply6(new Matrix6([1, , 3] as any), "q"));
console.log(apply6(new Matrix6([1, 1, 3, 1, 2]), 0.5));
class Matrix7 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply7(m: Matrix7, k: any): any { const e = m.e as any as number[]; return (e[4] + e[0]) * (e[0] + e[1]); }
console.log(apply7(new Matrix7([0.5, 1.5, 2.5, 3.5, 4.5]), 2));
console.log(apply7(new Matrix7([0.5]), 2));
console.log(apply7(new Matrix7([, 1.5, , , 2] as any), "q"));
console.log(apply7(new Matrix7([0.5, 1.5, 2.5, 3.5, 4.5]), 0.5));
class Matrix8 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply8(m: Matrix8, k: any): any { const e = m.e as any as number[]; return e[1] - e[0] + e[1] * k - e[0]; }
console.log(apply8(new Matrix8([1, 1, 3, 1, 2]), 2));
console.log(apply8(new Matrix8([]), 2));
console.log(apply8(new Matrix8([1, , 3] as any), "q"));
console.log(apply8(new Matrix8([1, 1, 3, 1, 2]), 0.5));
class Matrix9 { e: number[]; constructor(e: number[]) { this.e = e; } }
function apply9(m: Matrix9, k: any): any { const e = m.e as any as number[]; return e[1] - e[0] + e[1] * k - e[0]; }
console.log(apply9(new Matrix9([0.5, 1.5, 2.5, 3.5, 4.5]), 2));
console.log(apply9(new Matrix9([0.5]), 2));
console.log(apply9(new Matrix9([, 1.5, , , 2] as any), "q"));
console.log(apply9(new Matrix9([0.5, 1.5, 2.5, 3.5, 4.5]), 0.5));
export {};
