// Stack traces in which two given functions are every possible number of frames apart.
declare const console: any;
let made: Error | undefined; let mode = 0;
function leaf(n: number): number { if (mode === 0) return n & 1; made = new Error("e" + (n & 1)); if (mode === 2) throw made; return n & 1 }
type G = (next: number, n: number) => number;
function g0(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 1; return r }
function g1(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 2; r = (r * 3 + 1) | 0; return r }
function g2(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 3; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g3(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 4; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g4(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 5; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g5(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 6; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g6(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 7; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g7(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 8; return r }
function g8(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 9; r = (r * 3 + 1) | 0; return r }
function g9(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 10; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g10(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 11; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g11(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 12; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g12(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 13; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g13(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 14; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g14(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 15; return r }
function g15(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 16; r = (r * 3 + 1) | 0; return r }
function g16(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 17; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g17(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 18; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g18(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 19; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g19(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 20; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g20(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 21; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g21(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 22; return r }
function g22(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 23; r = (r * 3 + 1) | 0; return r }
function g23(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 24; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g24(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 25; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g25(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 26; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g26(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 27; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g27(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 28; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g28(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 29; return r }
function g29(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 30; r = (r * 3 + 1) | 0; return r }
function g30(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 31; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g31(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 32; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g32(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 33; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g33(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 34; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g34(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 35; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g35(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 36; return r }
function g36(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 37; r = (r * 3 + 1) | 0; return r }
function g37(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 38; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g38(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 39; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g39(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 40; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g40(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 41; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g41(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 42; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g42(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 43; return r }
function g43(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 44; r = (r * 3 + 1) | 0; return r }
function g44(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 45; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g45(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 46; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g46(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 47; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g47(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 48; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g48(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 49; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g49(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 50; return r }
function g50(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 51; r = (r * 3 + 1) | 0; return r }
function g51(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 52; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g52(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 53; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g53(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 54; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g54(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 55; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g55(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 56; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g56(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 57; return r }
function g57(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 58; r = (r * 3 + 1) | 0; return r }
function g58(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 59; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g59(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 60; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g60(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 61; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g61(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 62; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g62(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 63; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g63(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 64; return r }
function g64(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 65; r = (r * 3 + 1) | 0; return r }
function g65(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 66; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g66(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 67; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g67(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 68; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g68(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 69; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g69(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 70; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g70(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 71; return r }
function g71(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 72; r = (r * 3 + 1) | 0; return r }
function g72(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 73; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g73(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 74; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g74(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 75; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g75(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 76; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g76(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 77; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g77(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 78; return r }
function g78(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 79; r = (r * 3 + 1) | 0; return r }
function g79(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 80; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g80(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 81; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g81(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 82; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g82(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 83; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g83(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 84; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g84(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 85; return r }
function g85(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 86; r = (r * 3 + 1) | 0; return r }
function g86(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 87; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g87(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 88; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g88(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 89; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g89(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 90; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g90(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 91; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g91(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 92; return r }
function g92(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 93; r = (r * 3 + 1) | 0; return r }
function g93(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 94; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g94(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 95; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g95(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 96; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g96(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 97; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g97(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 98; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g98(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 99; return r }
function g99(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 100; r = (r * 3 + 1) | 0; return r }
function g100(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 1; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g101(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 2; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g102(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 3; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g103(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 4; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g104(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 5; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g105(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 6; return r }
function g106(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 7; r = (r * 3 + 1) | 0; return r }
function g107(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 8; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g108(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 9; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g109(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 10; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g110(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 11; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g111(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 12; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g112(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 13; return r }
function g113(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 14; r = (r * 3 + 1) | 0; return r }
function g114(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 15; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g115(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 16; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g116(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 17; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g117(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 18; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g118(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 19; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g119(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 20; return r }
function g120(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 21; r = (r * 3 + 1) | 0; return r }
function g121(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 22; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g122(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 23; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g123(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 24; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g124(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 25; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g125(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 26; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g126(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 27; return r }
function g127(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 28; r = (r * 3 + 1) | 0; return r }
function g128(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 29; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g129(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 30; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g130(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 31; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g131(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 32; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g132(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 33; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g133(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 34; return r }
function g134(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 35; r = (r * 3 + 1) | 0; return r }
function g135(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 36; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g136(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 37; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g137(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 38; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g138(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 39; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g139(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 40; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g140(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 41; return r }
function g141(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 42; r = (r * 3 + 1) | 0; return r }
function g142(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 43; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g143(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 44; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g144(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 45; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g145(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 46; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g146(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 47; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g147(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 48; return r }
function g148(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 49; r = (r * 3 + 1) | 0; return r }
function g149(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 50; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g150(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 51; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g151(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 52; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g152(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 53; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g153(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 54; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g154(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 55; return r }
function g155(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 56; r = (r * 3 + 1) | 0; return r }
function g156(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 57; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g157(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 58; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g158(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 59; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g159(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 60; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g160(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 61; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g161(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 62; return r }
function g162(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 63; r = (r * 3 + 1) | 0; return r }
function g163(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 64; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g164(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 65; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g165(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 66; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g166(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 67; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g167(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 68; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g168(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 69; return r }
function g169(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 70; r = (r * 3 + 1) | 0; return r }
function g170(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 71; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g171(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 72; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g172(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 73; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g173(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 74; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g174(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 75; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g175(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 76; return r }
function g176(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 77; r = (r * 3 + 1) | 0; return r }
function g177(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 78; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g178(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 79; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g179(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 80; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g180(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 81; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g181(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 82; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g182(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 83; return r }
function g183(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 84; r = (r * 3 + 1) | 0; return r }
function g184(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 85; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g185(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 86; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g186(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 87; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g187(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 88; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g188(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 89; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g189(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 90; return r }
function g190(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 91; r = (r * 3 + 1) | 0; return r }
function g191(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 92; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g192(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 93; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g193(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 94; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g194(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 95; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g195(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 96; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g196(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 97; return r }
function g197(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 98; r = (r * 3 + 1) | 0; return r }
function g198(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 99; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g199(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 100; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g200(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 1; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g201(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 2; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g202(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 3; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g203(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 4; return r }
function g204(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 5; r = (r * 3 + 1) | 0; return r }
function g205(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 6; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g206(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 7; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g207(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 8; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g208(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 9; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g209(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 10; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g210(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 11; return r }
function g211(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 12; r = (r * 3 + 1) | 0; return r }
function g212(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 13; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g213(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 14; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g214(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 15; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g215(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 16; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g216(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 17; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g217(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 18; return r }
function g218(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 19; r = (r * 3 + 1) | 0; return r }
function g219(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 20; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g220(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 21; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g221(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 22; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g222(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 23; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g223(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 24; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g224(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 25; return r }
function g225(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 26; r = (r * 3 + 1) | 0; return r }
function g226(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 27; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g227(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 28; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g228(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 29; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g229(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 30; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g230(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 31; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g231(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 32; return r }
function g232(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 33; r = (r * 3 + 1) | 0; return r }
function g233(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 34; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g234(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 35; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g235(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 36; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g236(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 37; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g237(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 38; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g238(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 39; return r }
function g239(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 40; r = (r * 3 + 1) | 0; return r }
function g240(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 41; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g241(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 42; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g242(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 43; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g243(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 44; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g244(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 45; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g245(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 46; return r }
function g246(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 47; r = (r * 3 + 1) | 0; return r }
function g247(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 48; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g248(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 49; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g249(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 50; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g250(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 51; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g251(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 52; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g252(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 53; return r }
function g253(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 54; r = (r * 3 + 1) | 0; return r }
function g254(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 55; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g255(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 56; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g256(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 57; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g257(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 58; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g258(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 59; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g259(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 60; return r }
function g260(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 61; r = (r * 3 + 1) | 0; return r }
function g261(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 62; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g262(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 63; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g263(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 64; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g264(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 65; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g265(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 66; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g266(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 67; return r }
function g267(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 68; r = (r * 3 + 1) | 0; return r }
function g268(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 69; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g269(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 70; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g270(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 71; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g271(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 72; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g272(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 73; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g273(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 74; return r }
function g274(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 75; r = (r * 3 + 1) | 0; return r }
function g275(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 76; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g276(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 77; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g277(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 78; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g278(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 79; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g279(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 80; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g280(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 81; return r }
function g281(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 82; r = (r * 3 + 1) | 0; return r }
function g282(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 83; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g283(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 84; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g284(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 85; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g285(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 86; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g286(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 87; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g287(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 88; return r }
function g288(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 89; r = (r * 3 + 1) | 0; return r }
function g289(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 90; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g290(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 91; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g291(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 92; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g292(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 93; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g293(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 94; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g294(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 95; return r }
function g295(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 96; r = (r * 3 + 1) | 0; return r }
function g296(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 97; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g297(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 98; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g298(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 99; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g299(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 100; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g300(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 1; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g301(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 2; return r }
function g302(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 3; r = (r * 3 + 1) | 0; return r }
function g303(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 4; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g304(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 5; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g305(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 6; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g306(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 7; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g307(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 8; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g308(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 9; return r }
function g309(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 10; r = (r * 3 + 1) | 0; return r }
function g310(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 11; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g311(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 12; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g312(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 13; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
function g313(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 14; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; return r }
function g314(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 15; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; r = (r * 3 + 5) | 0; r = (r * 3 + 6) | 0; return r }
function g315(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 16; return r }
function g316(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 17; r = (r * 3 + 1) | 0; return r }
function g317(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 18; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; return r }
function g318(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 19; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; return r }
function g319(next: number, n: number): number { let r = (next < 0 ? leaf(n) : table[next](-1, n)) + 20; r = (r * 3 + 1) | 0; r = (r * 3 + 2) | 0; r = (r * 3 + 3) | 0; r = (r * 3 + 4) | 0; return r }
const table: G[] = [g0, g1, g2, g3, g4, g5, g6, g7, g8, g9, g10, g11, g12, g13, g14, g15, g16, g17, g18, g19, g20, g21, g22, g23, g24, g25, g26, g27, g28, g29, g30, g31, g32, g33, g34, g35, g36, g37, g38, g39, g40, g41, g42, g43, g44, g45, g46, g47, g48, g49, g50, g51, g52, g53, g54, g55, g56, g57, g58, g59, g60, g61, g62, g63, g64, g65, g66, g67, g68, g69, g70, g71, g72, g73, g74, g75, g76, g77, g78, g79, g80, g81, g82, g83, g84, g85, g86, g87, g88, g89, g90, g91, g92, g93, g94, g95, g96, g97, g98, g99, g100, g101, g102, g103, g104, g105, g106, g107, g108, g109, g110, g111, g112, g113, g114, g115, g116, g117, g118, g119, g120, g121, g122, g123, g124, g125, g126, g127, g128, g129, g130, g131, g132, g133, g134, g135, g136, g137, g138, g139, g140, g141, g142, g143, g144, g145, g146, g147, g148, g149, g150, g151, g152, g153, g154, g155, g156, g157, g158, g159, g160, g161, g162, g163, g164, g165, g166, g167, g168, g169, g170, g171, g172, g173, g174, g175, g176, g177, g178, g179, g180, g181, g182, g183, g184, g185, g186, g187, g188, g189, g190, g191, g192, g193, g194, g195, g196, g197, g198, g199, g200, g201, g202, g203, g204, g205, g206, g207, g208, g209, g210, g211, g212, g213, g214, g215, g216, g217, g218, g219, g220, g221, g222, g223, g224, g225, g226, g227, g228, g229, g230, g231, g232, g233, g234, g235, g236, g237, g238, g239, g240, g241, g242, g243, g244, g245, g246, g247, g248, g249, g250, g251, g252, g253, g254, g255, g256, g257, g258, g259, g260, g261, g262, g263, g264, g265, g266, g267, g268, g269, g270, g271, g272, g273, g274, g275, g276, g277, g278, g279, g280, g281, g282, g283, g284, g285, g286, g287, g288, g289, g290, g291, g292, g293, g294, g295, g296, g297, g298, g299, g300, g301, g302, g303, g304, g305, g306, g307, g308, g309, g310, g311, g312, g313, g314, g315, g316, g317, g318, g319];
function drive(i: number, j: number, turns: number): number {
  let s = 0, a = i + 1, b = j + 2, c = turns + 3, d = i * 5 + 4, e = j * 7 + 5, f = i + j + 6;
  for (let t = 0; t < turns; t++) {
    try { s += table[i](j, t) } catch (x) { s += 1000 }
    a = (a + b) | 0; b = (b ^ c) | 0; c = (c + d) | 0; d = (d ^ e) | 0; e = (e + f) | 0; f = (f ^ a) | 0;
  }
  return s + a + b + c + d + e + f;
}
function names(e: Error | undefined): string { return String(e && e.stack).split("\n").filter((l, i) => i > 0 || !l.startsWith("Error")).slice(0, 4).map(l => l.replace(/^\s*at /, "").split(/[@ ]/)[0]).join(" < ") }
let lines = 0, wrong = 0, first = "", sum = 0;
for (const m of [1, 2]) for (const i of [0, 1, 2]) for (let j = 0; j < table.length; j++) {
  mode = m; const kept = drive(i, j, 3); const got = names(made), want = "leaf < g" + j + " < g" + i + " < drive";
  lines++; sum = (sum * 31 + kept) | 0;
  if (got !== want) { wrong++; if (!first) first = m + " " + i + " " + j + ": " + got + " for " + want }
}
console.log("pairs " + lines + ", wrong " + wrong + (first ? ": " + first : "") + ", kept " + sum);
