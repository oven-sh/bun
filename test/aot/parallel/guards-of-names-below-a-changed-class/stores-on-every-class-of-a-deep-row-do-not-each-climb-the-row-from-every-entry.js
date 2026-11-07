// A row of 40 classes, each below the one before, the method on the topmost, called behind the guard of its name at every second class; code that nobody sees stores under the name on every class from the top down.
// From each of the 20 entries the way up to the changed class, or past it to the top of the row, is as long as the row: 39 stores x 20 entries x the height was a cube.
// The way down and the ways up go in step, a class each a turn, and the way down is through first: a store on the class with k classes below it looks at itself, k classes down and k - 1 up: 2k.
// COUNTER: ClassesLookedAtToEndGuardsOfNames = 1560
const storeOnAll = (0, eval)('(classes) => { for (const one of classes) one.prototype.tell = () => 2; }');
class K0 { tell() { return 1; } }
class K1 extends K0 { } function r1(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o1 = new K1();
class K2 extends K1 { }
class K3 extends K2 { } function r3(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o3 = new K3();
class K4 extends K3 { }
class K5 extends K4 { } function r5(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o5 = new K5();
class K6 extends K5 { }
class K7 extends K6 { } function r7(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o7 = new K7();
class K8 extends K7 { }
class K9 extends K8 { } function r9(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o9 = new K9();
class K10 extends K9 { }
class K11 extends K10 { } function r11(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o11 = new K11();
class K12 extends K11 { }
class K13 extends K12 { } function r13(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o13 = new K13();
class K14 extends K13 { }
class K15 extends K14 { } function r15(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o15 = new K15();
class K16 extends K15 { }
class K17 extends K16 { } function r17(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o17 = new K17();
class K18 extends K17 { }
class K19 extends K18 { } function r19(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o19 = new K19();
class K20 extends K19 { }
class K21 extends K20 { } function r21(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o21 = new K21();
class K22 extends K21 { }
class K23 extends K22 { } function r23(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o23 = new K23();
class K24 extends K23 { }
class K25 extends K24 { } function r25(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o25 = new K25();
class K26 extends K25 { }
class K27 extends K26 { } function r27(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o27 = new K27();
class K28 extends K27 { }
class K29 extends K28 { } function r29(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o29 = new K29();
class K30 extends K29 { }
class K31 extends K30 { } function r31(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o31 = new K31();
class K32 extends K31 { }
class K33 extends K32 { } function r33(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o33 = new K33();
class K34 extends K33 { }
class K35 extends K34 { } function r35(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o35 = new K35();
class K36 extends K35 { }
class K37 extends K36 { } function r37(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o37 = new K37();
class K38 extends K37 { }
class K39 extends K38 { } function r39(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; } const o39 = new K39();
function all() { return r1(o1) + r3(o3) + r5(o5) + r7(o7) + r9(o9) + r11(o11) + r13(o13) + r15(o15) + r17(o17) + r19(o19) + r21(o21) + r23(o23) + r25(o25) + r27(o27) + r29(o29) + r31(o31) + r33(o33) + r35(o35) + r37(o37) + r39(o39); }
console.log(all());
storeOnAll([K0, K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14, K15, K16, K17, K18, K19, K20, K21, K22, K23, K24, K25, K26, K27, K28, K29, K30, K31, K32, K33, K34, K35, K36, K37, K38, K39]);
console.log(all());
