const argv: string[] = process.argv;
const ROW: string = argv[2] ?? "", COUNT: number = parseInt(argv[3] ?? "0", 10) | 0, LEN: number = parseInt(argv[4] ?? "2", 10) | 0, WORD: string = argv[5] ?? "lit_zz", VERB0: string = argv[6] ?? "DELETE", VERB1: string = argv[7] ?? "PATCH";
let G0 = (LEN + -2) | 0, G1 = (LEN + -1) | 0, G2 = (LEN + 0) | 0, G3 = (LEN + 1) | 0, G4 = (LEN + 2) | 0, G5 = (LEN + 3) | 0, G6 = (LEN + 4) | 0, G7 = (LEN + 5) | 0, G8 = (LEN + 6) | 0, G9 = (LEN + 7) | 0, G10 = (LEN + 8) | 0, G11 = (LEN + 9) | 0, G12 = (LEN + 10) | 0, G13 = (LEN + 11) | 0, G14 = (LEN + 12) | 0, G15 = (LEN + 13) | 0;
function fill(n: number, v: number): number[] { const r: number[] = []; for (let i = 0; i < n; ++i) r.push((v + i) | 0); return r; }
class T {
    next: T; nn: T | null; any: unknown; s: string; e: string; m: string;
    f0: number; d0: number; r0: T; l0: number[]; ss0: string; f1: number; d1: number; r1: T; l1: number[]; ss1: string; f2: number; d2: number; r2: T; l2: number[]; ss2: string; f3: number; d3: number; r3: T; l3: number[]; ss3: string; f4: number; d4: number; r4: T; l4: number[]; ss4: string; f5: number; d5: number; r5: T; l5: number[]; ss5: string; f6: number; d6: number; r6: T; l6: number[]; ss6: string; f7: number; d7: number; r7: T; l7: number[]; ss7: string; f8: number; d8: number; r8: T; l8: number[]; ss8: string; f9: number; d9: number; r9: T; l9: number[]; ss9: string; f10: number; d10: number; r10: T; l10: number[]; ss10: string; f11: number; d11: number; r11: T; l11: number[]; ss11: string; f12: number; d12: number; r12: T; l12: number[]; ss12: string; f13: number; d13: number; r13: T; l13: number[]; ss13: string; f14: number; d14: number; r14: T; l14: number[]; ss14: string; f15: number; d15: number; r15: T; l15: number[]; ss15: string;
    constructor(seed: number, verb: string) {
        this.next = this; this.nn = null; this.any = this; this.s = WORD.slice(0, 5) + (seed & 7); this.e = WORD.slice(0, 3) + WORD.slice(3); this.m = verb;
        this.f0 = (seed + 0) | 0; this.d0 = seed + 0.5; this.r0 = this; this.l0 = fill(LEN, seed + 0); this.ss0 = "t0" + seed; this.f1 = (seed + 1) | 0; this.d1 = seed + 1.5; this.r1 = this; this.l1 = fill(LEN, seed + 1); this.ss1 = "t1" + seed; this.f2 = (seed + 2) | 0; this.d2 = seed + 2.5; this.r2 = this; this.l2 = fill(LEN, seed + 2); this.ss2 = "t2" + seed; this.f3 = (seed + 3) | 0; this.d3 = seed + 3.5; this.r3 = this; this.l3 = fill(LEN, seed + 3); this.ss3 = "t3" + seed; this.f4 = (seed + 4) | 0; this.d4 = seed + 4.5; this.r4 = this; this.l4 = fill(LEN, seed + 4); this.ss4 = "t4" + seed; this.f5 = (seed + 5) | 0; this.d5 = seed + 5.5; this.r5 = this; this.l5 = fill(LEN, seed + 5); this.ss5 = "t5" + seed; this.f6 = (seed + 6) | 0; this.d6 = seed + 6.5; this.r6 = this; this.l6 = fill(LEN, seed + 6); this.ss6 = "t6" + seed; this.f7 = (seed + 7) | 0; this.d7 = seed + 7.5; this.r7 = this; this.l7 = fill(LEN, seed + 7); this.ss7 = "t7" + seed; this.f8 = (seed + 8) | 0; this.d8 = seed + 8.5; this.r8 = this; this.l8 = fill(LEN, seed + 8); this.ss8 = "t8" + seed; this.f9 = (seed + 9) | 0; this.d9 = seed + 9.5; this.r9 = this; this.l9 = fill(LEN, seed + 9); this.ss9 = "t9" + seed; this.f10 = (seed + 10) | 0; this.d10 = seed + 10.5; this.r10 = this; this.l10 = fill(LEN, seed + 10); this.ss10 = "t10" + seed; this.f11 = (seed + 11) | 0; this.d11 = seed + 11.5; this.r11 = this; this.l11 = fill(LEN, seed + 11); this.ss11 = "t11" + seed; this.f12 = (seed + 12) | 0; this.d12 = seed + 12.5; this.r12 = this; this.l12 = fill(LEN, seed + 12); this.ss12 = "t12" + seed; this.f13 = (seed + 13) | 0; this.d13 = seed + 13.5; this.r13 = this; this.l13 = fill(LEN, seed + 13); this.ss13 = "t13" + seed; this.f14 = (seed + 14) | 0; this.d14 = seed + 14.5; this.r14 = this; this.l14 = fill(LEN, seed + 14); this.ss14 = "t14" + seed; this.f15 = (seed + 15) | 0; this.d15 = seed + 15.5; this.r15 = this; this.l15 = fill(LEN, seed + 15); this.ss15 = "t15" + seed;
    }
}
const A0 = new T(LEN - 1, VERB0), A1 = new T(LEN, VERB1); A0.next = A1; A1.next = A0; A0.nn = A1; A1.nn = A0; A0.any = A1; A1.any = A0; A0.f0 = LEN - 2; A1.f0 = LEN - 1;
function array_literal_constants_4(p: T): T {
    if (G15 > 1000000) { G1 = ((G4 + 3) ^ G8) | 0; G2 = ((G5 + 5) ^ G9) | 0; G3 = ((G6 + 7) ^ G10) | 0; G4 = ((G7 + 9) ^ G11) | 0; G5 = ((G8 + 11) ^ G12) | 0; G6 = ((G9 + 13) ^ G13) | 0; G7 = ((G10 + 15) ^ G1) | 0; G8 = ((G11 + 17) ^ G2) | 0; G9 = ((G12 + 19) ^ G3) | 0; G10 = ((G13 + 21) ^ G4) | 0; G11 = ((G1 + 23) ^ G5) | 0; G12 = ((G2 + 25) ^ G6) | 0; G13 = ((G3 + 27) ^ G7) | 0; G1 = ((G4 + 29) ^ G8) | 0; G2 = ((G5 + 31) ^ G9) | 0; G3 = ((G6 + 33) ^ G10) | 0; G4 = ((G7 + 35) ^ G11) | 0; G5 = ((G8 + 37) ^ G12) | 0; G6 = ((G9 + 39) ^ G13) | 0; G7 = ((G10 + 41) ^ G1) | 0; G8 = ((G11 + 43) ^ G2) | 0; G9 = ((G12 + 45) ^ G3) | 0; G10 = ((G13 + 47) ^ G4) | 0; G11 = ((G1 + 49) ^ G5) | 0; G12 = ((G2 + 51) ^ G6) | 0; G13 = ((G3 + 53) ^ G7) | 0; G1 = ((G4 + 55) ^ G8) | 0; G2 = ((G5 + 57) ^ G9) | 0; G3 = ((G6 + 59) ^ G10) | 0; G4 = ((G7 + 61) ^ G11) | 0; G5 = ((G8 + 63) ^ G12) | 0; G6 = ((G9 + 65) ^ G13) | 0; G7 = ((G10 + 67) ^ G1) | 0; G8 = ((G11 + 69) ^ G2) | 0; G9 = ((G12 + 71) ^ G3) | 0; G10 = ((G13 + 73) ^ G4) | 0; G11 = ((G1 + 75) ^ G5) | 0; G12 = ((G2 + 77) ^ G6) | 0; G13 = ((G3 + 79) ^ G7) | 0; G1 = ((G4 + 81) ^ G8) | 0; G2 = ((G5 + 83) ^ G9) | 0; G3 = ((G6 + 85) ^ G10) | 0; G4 = ((G7 + 87) ^ G11) | 0; G5 = ((G8 + 89) ^ G12) | 0; G6 = ((G9 + 91) ^ G13) | 0; G7 = ((G10 + 93) ^ G1) | 0; G8 = ((G11 + 95) ^ G2) | 0; G9 = ((G12 + 97) ^ G3) | 0; G10 = ((G13 + 99) ^ G4) | 0; G11 = ((G1 + 101) ^ G5) | 0; G12 = ((G2 + 103) ^ G6) | 0; G13 = ((G3 + 105) ^ G7) | 0; G1 = ((G4 + 107) ^ G8) | 0; G2 = ((G5 + 109) ^ G9) | 0; G3 = ((G6 + 111) ^ G10) | 0; G4 = ((G7 + 113) ^ G11) | 0; G5 = ((G8 + 115) ^ G12) | 0; G6 = ((G9 + 117) ^ G13) | 0; G7 = ((G10 + 119) ^ G1) | 0; G8 = ((G11 + 121) ^ G2) | 0; } 
    p.l0 = [0, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l1 = [1, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l2 = [2, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l3 = [3, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    return p;
}
function drive_array_literal_constants_4(n: number): number {
    let a: T = A0, x = LEN | 0, y = 0.5; 
    for (let i = 0; i < n; ++i) { a = array_literal_constants_4(a); a = a.next; }
    return (x ^ a.f0 ^ (y | 0) ^ a.l0[1] ^ a.l1[1] ^ a.l2[1] ^ a.l3[1] ^ a.l4[1] ^ a.l5[1] ^ a.l6[1] ^ a.l7[1] ^ a.l8[1] ^ a.l9[1] ^ a.l10[1] ^ a.l11[1] ^ a.l12[1] ^ a.l13[1] ^ a.l14[1] ^ a.l15[1]) | 0;
}
function array_literal_constants_12(p: T): T {
    if (G15 > 1000000) { G1 = ((G4 + 3) ^ G8) | 0; G2 = ((G5 + 5) ^ G9) | 0; G3 = ((G6 + 7) ^ G10) | 0; G4 = ((G7 + 9) ^ G11) | 0; G5 = ((G8 + 11) ^ G12) | 0; G6 = ((G9 + 13) ^ G13) | 0; G7 = ((G10 + 15) ^ G1) | 0; G8 = ((G11 + 17) ^ G2) | 0; G9 = ((G12 + 19) ^ G3) | 0; G10 = ((G13 + 21) ^ G4) | 0; G11 = ((G1 + 23) ^ G5) | 0; G12 = ((G2 + 25) ^ G6) | 0; G13 = ((G3 + 27) ^ G7) | 0; G1 = ((G4 + 29) ^ G8) | 0; G2 = ((G5 + 31) ^ G9) | 0; G3 = ((G6 + 33) ^ G10) | 0; G4 = ((G7 + 35) ^ G11) | 0; G5 = ((G8 + 37) ^ G12) | 0; G6 = ((G9 + 39) ^ G13) | 0; G7 = ((G10 + 41) ^ G1) | 0; G8 = ((G11 + 43) ^ G2) | 0; G9 = ((G12 + 45) ^ G3) | 0; G10 = ((G13 + 47) ^ G4) | 0; G11 = ((G1 + 49) ^ G5) | 0; G12 = ((G2 + 51) ^ G6) | 0; G13 = ((G3 + 53) ^ G7) | 0; G1 = ((G4 + 55) ^ G8) | 0; G2 = ((G5 + 57) ^ G9) | 0; G3 = ((G6 + 59) ^ G10) | 0; G4 = ((G7 + 61) ^ G11) | 0; G5 = ((G8 + 63) ^ G12) | 0; G6 = ((G9 + 65) ^ G13) | 0; G7 = ((G10 + 67) ^ G1) | 0; G8 = ((G11 + 69) ^ G2) | 0; G9 = ((G12 + 71) ^ G3) | 0; G10 = ((G13 + 73) ^ G4) | 0; G11 = ((G1 + 75) ^ G5) | 0; G12 = ((G2 + 77) ^ G6) | 0; G13 = ((G3 + 79) ^ G7) | 0; G1 = ((G4 + 81) ^ G8) | 0; G2 = ((G5 + 83) ^ G9) | 0; G3 = ((G6 + 85) ^ G10) | 0; G4 = ((G7 + 87) ^ G11) | 0; G5 = ((G8 + 89) ^ G12) | 0; G6 = ((G9 + 91) ^ G13) | 0; G7 = ((G10 + 93) ^ G1) | 0; G8 = ((G11 + 95) ^ G2) | 0; G9 = ((G12 + 97) ^ G3) | 0; G10 = ((G13 + 99) ^ G4) | 0; G11 = ((G1 + 101) ^ G5) | 0; G12 = ((G2 + 103) ^ G6) | 0; G13 = ((G3 + 105) ^ G7) | 0; G1 = ((G4 + 107) ^ G8) | 0; G2 = ((G5 + 109) ^ G9) | 0; G3 = ((G6 + 111) ^ G10) | 0; G4 = ((G7 + 113) ^ G11) | 0; G5 = ((G8 + 115) ^ G12) | 0; G6 = ((G9 + 117) ^ G13) | 0; G7 = ((G10 + 119) ^ G1) | 0; G8 = ((G11 + 121) ^ G2) | 0; } 
    p.l0 = [0, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l1 = [1, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l2 = [2, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l3 = [3, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l4 = [4, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l5 = [5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l6 = [6, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l7 = [7, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l8 = [8, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l9 = [9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l10 = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    p.l11 = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    return p;
}
function drive_array_literal_constants_12(n: number): number {
    let a: T = A0, x = LEN | 0, y = 0.5; 
    for (let i = 0; i < n; ++i) { a = array_literal_constants_12(a); a = a.next; }
    return (x ^ a.f0 ^ (y | 0) ^ a.l0[1] ^ a.l1[1] ^ a.l2[1] ^ a.l3[1] ^ a.l4[1] ^ a.l5[1] ^ a.l6[1] ^ a.l7[1] ^ a.l8[1] ^ a.l9[1] ^ a.l10[1] ^ a.l11[1] ^ a.l12[1] ^ a.l13[1] ^ a.l14[1] ^ a.l15[1]) | 0;
}
const rows = new Map<string, (n: number) => number>([["array_literal_constants_4", drive_array_literal_constants_4], ["array_literal_constants_12", drive_array_literal_constants_12]]);
const chosen = rows.get(ROW);
if (chosen !== undefined) console.log(ROW, chosen(COUNT)); else console.log("no row", ROW);
