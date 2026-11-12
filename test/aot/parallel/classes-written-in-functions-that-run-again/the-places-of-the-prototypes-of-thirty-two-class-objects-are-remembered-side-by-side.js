// Thirty-two classes, none proven to be evaluated once, each with a static of its own, so that each class object has a structure of its own, constructed in turns.
// Where `prototype` lies is remembered by structure in a table without chains: two structures on one place push each other out at every turn.
// Eight places cannot hold more than seven of thirty-two: 78% of 160,000 reads or more went to the run time (all of them, as measured: the structures lie a fixed stride apart
// and three bits of their numbers told two places). By a product among 256 some 12% are expected to; over 75%: less than once in a million builds.
// COUNT: operation:operationAOTGetClassPrototype <= 120000
"use strict";
const kept = new Array(64).fill(null);
let C0; function write0() { C0 = class C0 { constructor(n) { this.size = n + 0; } static mark0 = 0; }; } write0();
let C1; function write1() { C1 = class C1 { constructor(n) { this.size = n + 1; } static mark1 = 1; }; } write1();
let C2; function write2() { C2 = class C2 { constructor(n) { this.size = n + 2; } static mark2 = 2; }; } write2();
let C3; function write3() { C3 = class C3 { constructor(n) { this.size = n + 3; } static mark3 = 3; }; } write3();
let C4; function write4() { C4 = class C4 { constructor(n) { this.size = n + 4; } static mark4 = 4; }; } write4();
let C5; function write5() { C5 = class C5 { constructor(n) { this.size = n + 5; } static mark5 = 5; }; } write5();
let C6; function write6() { C6 = class C6 { constructor(n) { this.size = n + 6; } static mark6 = 6; }; } write6();
let C7; function write7() { C7 = class C7 { constructor(n) { this.size = n + 7; } static mark7 = 7; }; } write7();
let C8; function write8() { C8 = class C8 { constructor(n) { this.size = n + 8; } static mark8 = 8; }; } write8();
let C9; function write9() { C9 = class C9 { constructor(n) { this.size = n + 9; } static mark9 = 9; }; } write9();
let C10; function write10() { C10 = class C10 { constructor(n) { this.size = n + 10; } static mark10 = 10; }; } write10();
let C11; function write11() { C11 = class C11 { constructor(n) { this.size = n + 11; } static mark11 = 11; }; } write11();
let C12; function write12() { C12 = class C12 { constructor(n) { this.size = n + 12; } static mark12 = 12; }; } write12();
let C13; function write13() { C13 = class C13 { constructor(n) { this.size = n + 13; } static mark13 = 13; }; } write13();
let C14; function write14() { C14 = class C14 { constructor(n) { this.size = n + 14; } static mark14 = 14; }; } write14();
let C15; function write15() { C15 = class C15 { constructor(n) { this.size = n + 15; } static mark15 = 15; }; } write15();
let C16; function write16() { C16 = class C16 { constructor(n) { this.size = n + 16; } static mark16 = 16; }; } write16();
let C17; function write17() { C17 = class C17 { constructor(n) { this.size = n + 17; } static mark17 = 17; }; } write17();
let C18; function write18() { C18 = class C18 { constructor(n) { this.size = n + 18; } static mark18 = 18; }; } write18();
let C19; function write19() { C19 = class C19 { constructor(n) { this.size = n + 19; } static mark19 = 19; }; } write19();
let C20; function write20() { C20 = class C20 { constructor(n) { this.size = n + 20; } static mark20 = 20; }; } write20();
let C21; function write21() { C21 = class C21 { constructor(n) { this.size = n + 21; } static mark21 = 21; }; } write21();
let C22; function write22() { C22 = class C22 { constructor(n) { this.size = n + 22; } static mark22 = 22; }; } write22();
let C23; function write23() { C23 = class C23 { constructor(n) { this.size = n + 23; } static mark23 = 23; }; } write23();
let C24; function write24() { C24 = class C24 { constructor(n) { this.size = n + 24; } static mark24 = 24; }; } write24();
let C25; function write25() { C25 = class C25 { constructor(n) { this.size = n + 25; } static mark25 = 25; }; } write25();
let C26; function write26() { C26 = class C26 { constructor(n) { this.size = n + 26; } static mark26 = 26; }; } write26();
let C27; function write27() { C27 = class C27 { constructor(n) { this.size = n + 27; } static mark27 = 27; }; } write27();
let C28; function write28() { C28 = class C28 { constructor(n) { this.size = n + 28; } static mark28 = 28; }; } write28();
let C29; function write29() { C29 = class C29 { constructor(n) { this.size = n + 29; } static mark29 = 29; }; } write29();
let C30; function write30() { C30 = class C30 { constructor(n) { this.size = n + 30; } static mark30 = 30; }; } write30();
let C31; function write31() { C31 = class C31 { constructor(n) { this.size = n + 31; } static mark31 = 31; }; } write31();
function run() { let sum = 0; for (let round = 0; round < 5000; round++) { kept[0] = new C0(round); kept[1] = new C1(round); kept[2] = new C2(round); kept[3] = new C3(round); kept[4] = new C4(round); kept[5] = new C5(round); kept[6] = new C6(round); kept[7] = new C7(round); kept[8] = new C8(round); kept[9] = new C9(round); kept[10] = new C10(round); kept[11] = new C11(round); kept[12] = new C12(round); kept[13] = new C13(round); kept[14] = new C14(round); kept[15] = new C15(round); kept[16] = new C16(round); kept[17] = new C17(round); kept[18] = new C18(round); kept[19] = new C19(round); kept[20] = new C20(round); kept[21] = new C21(round); kept[22] = new C22(round); kept[23] = new C23(round); kept[24] = new C24(round); kept[25] = new C25(round); kept[26] = new C26(round); kept[27] = new C27(round); kept[28] = new C28(round); kept[29] = new C29(round); kept[30] = new C30(round); kept[31] = new C31(round); sum += kept[round % 32].size; } return sum; }
console.log(run());
if (globalThis.never) { write0(); write1(); write2(); write3(); write4(); write5(); write6(); write7(); write8(); write9(); write10(); write11(); write12(); write13(); write14(); write15(); write16(); write17(); write18(); write19(); write20(); write21(); write22(); write23(); write24(); write25(); write26(); write27(); write28(); write29(); write30(); write31(); }
