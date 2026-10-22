var unseen = new Function("x", "return x");
globalThis.made = [];
var lines = [];
function F0(x) { this.x = x; }
F0.prototype.a = function (x) { return "a0:" + x; };
F0.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F0.prototype.c = function () { return "c0"; };
function F1(x) { this.x = x; }
F1.prototype.a = function (x) { return "a1:" + x; };
F1.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F1.prototype.c = function () { return "c1"; };
function F2(x) { this.x = x; }
F2.prototype.a = function (x) { return "a2:" + x; };
F2.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F2.prototype.c = function () { return "c2"; };
function F3(x) { this.x = x; }
F3.prototype.a = function (x) { return "a3:" + x; };
F3.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F3.prototype.c = function () { return "c3"; };
function F4(x) { this.x = x; }
F4.prototype.a = function (x) { return "a4:" + x; };
F4.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F4.prototype.c = function () { return "c4"; };
function F5(x) { this.x = x; }
F5.prototype.a = function (x) { return "a5:" + x; };
F5.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F5.prototype.c = function () { return "c5"; };
function F6(x) { this.x = x; }
F6.prototype.a = function (x) { return "a6:" + x; };
F6.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F6.prototype.c = function () { return "c6"; };
function F7(x) { this.x = x; }
F7.prototype.a = function (x) { return "a7:" + x; };
F7.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F7.prototype.c = function () { return "c7"; };
function F8(x) { this.x = x; }
F8.prototype.a = function (x) { return "a8:" + x; };
F8.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F8.prototype.c = function () { return "c8"; };
function F9(x) { this.x = x; }
F9.prototype.a = function (x) { return "a9:" + x; };
F9.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F9.prototype.c = function () { return "c9"; };
function F10(x) { this.x = x; }
F10.prototype.a = function (x) { return "a10:" + x; };
F10.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F10.prototype.c = function () { return "c10"; };
function F11(x) { this.x = x; }
F11.prototype.a = function (x) { return "a11:" + x; };
F11.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F11.prototype.c = function () { return "c11"; };
function F12(x) { this.x = x; }
F12.prototype.a = function (x) { return "a12:" + x; };
F12.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F12.prototype.c = function () { return "c12"; };
function F13(x) { this.x = x; }
F13.prototype.a = function (x) { return "a13:" + x; };
F13.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F13.prototype.c = function () { return "c13"; };
function F14(x) { this.x = x; }
F14.prototype.a = function (x) { return "a14:" + x; };
F14.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F14.prototype.c = function () { return "c14"; };
function F15(x) { this.x = x; }
F15.prototype.a = function (x) { return "a15:" + x; };
F15.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F15.prototype.c = function () { return "c15"; };
function F16(x) { this.x = x; }
F16.prototype.a = function (x) { return "a16:" + x; };
F16.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F16.prototype.c = function () { return "c16"; };
function F17(x) { this.x = x; }
F17.prototype.a = function (x) { return "a17:" + x; };
F17.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F17.prototype.c = function () { return "c17"; };
function F18(x) { this.x = x; }
F18.prototype.a = function (x) { return "a18:" + x; };
F18.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F18.prototype.c = function () { return "c18"; };
function F19(x) { this.x = x; }
F19.prototype.a = function (x) { return "a19:" + x; };
F19.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F19.prototype.c = function () { return "c19"; };
function F20(x) { this.x = x; }
F20.prototype.a = function (x) { return "a20:" + x; };
F20.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F20.prototype.c = function () { return "c20"; };
function F21(x) { this.x = x; }
F21.prototype.a = function (x) { return "a21:" + x; };
F21.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F21.prototype.c = function () { return "c21"; };
function F22(x) { this.x = x; }
F22.prototype.a = function (x) { return "a22:" + x; };
F22.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F22.prototype.c = function () { return "c22"; };
function F23(x) { this.x = x; }
F23.prototype.a = function (x) { return "a23:" + x; };
F23.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F23.prototype.c = function () { return "c23"; };
function F24(x) { this.x = x; }
F24.prototype.a = function (x) { return "a24:" + x; };
F24.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F24.prototype.c = function () { return "c24"; };
function F25(x) { this.x = x; }
F25.prototype.a = function (x) { return "a25:" + x; };
F25.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F25.prototype.c = function () { return "c25"; };
function F26(x) { this.x = x; }
F26.prototype.a = function (x) { return "a26:" + x; };
F26.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F26.prototype.c = function () { return "c26"; };
function F27(x) { this.x = x; }
F27.prototype.a = function (x) { return "a27:" + x; };
F27.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F27.prototype.c = function () { return "c27"; };
function F28(x) { this.x = x; }
F28.prototype.a = function (x) { return "a28:" + x; };
F28.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F28.prototype.c = function () { return "c28"; };
function F29(x) { this.x = x; }
F29.prototype.a = function (x) { return "a29:" + x; };
F29.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F29.prototype.c = function () { return "c29"; };
function F30(x) { this.x = x; }
F30.prototype.a = function (x) { return "a30:" + x; };
F30.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F30.prototype.c = function () { return "c30"; };
function F31(x) { this.x = x; }
F31.prototype.a = function (x) { return "a31:" + x; };
F31.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F31.prototype.c = function () { return "c31"; };
function F32(x) { this.x = x; }
F32.prototype.a = function (x) { return "a32:" + x; };
F32.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F32.prototype.c = function () { return "c32"; };
function F33(x) { this.x = x; }
F33.prototype.a = function (x) { return "a33:" + x; };
F33.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F33.prototype.c = function () { return "c33"; };
function F34(x) { this.x = x; }
F34.prototype.a = function (x) { return "a34:" + x; };
F34.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F34.prototype.c = function () { return "c34"; };
function F35(x) { this.x = x; }
F35.prototype.a = function (x) { return "a35:" + x; };
F35.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F35.prototype.c = function () { return "c35"; };
function F36(x) { this.x = x; }
F36.prototype.a = function (x) { return "a36:" + x; };
F36.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F36.prototype.c = function () { return "c36"; };
function F37(x) { this.x = x; }
F37.prototype.a = function (x) { return "a37:" + x; };
F37.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F37.prototype.c = function () { return "c37"; };
function F38(x) { this.x = x; }
F38.prototype.a = function (x) { return "a38:" + x; };
F38.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F38.prototype.c = function () { return "c38"; };
function F39(x) { this.x = x; }
F39.prototype.a = function (x) { return "a39:" + x; };
F39.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F39.prototype.c = function () { return "c39"; };
function F40(x) { this.x = x; }
F40.prototype.a = function (x) { return "a40:" + x; };
F40.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F40.prototype.c = function () { return "c40"; };
function F41(x) { this.x = x; }
F41.prototype.a = function (x) { return "a41:" + x; };
F41.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F41.prototype.c = function () { return "c41"; };
function F42(x) { this.x = x; }
F42.prototype.a = function (x) { return "a42:" + x; };
F42.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F42.prototype.c = function () { return "c42"; };
function F43(x) { this.x = x; }
F43.prototype.a = function (x) { return "a43:" + x; };
F43.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F43.prototype.c = function () { return "c43"; };
function F44(x) { this.x = x; }
F44.prototype.a = function (x) { return "a44:" + x; };
F44.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F44.prototype.c = function () { return "c44"; };
function F45(x) { this.x = x; }
F45.prototype.a = function (x) { return "a45:" + x; };
F45.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F45.prototype.c = function () { return "c45"; };
function F46(x) { this.x = x; }
F46.prototype.a = function (x) { return "a46:" + x; };
F46.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F46.prototype.c = function () { return "c46"; };
function F47(x) { this.x = x; }
F47.prototype.a = function (x) { return "a47:" + x; };
F47.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F47.prototype.c = function () { return "c47"; };
function askAll(label) {
  var answers = [];
  for (var index = 0; index < made.length; index++)
    answers.push(made[index].b(index));
  lines.push(label + " " + answers.join(" "));
}
// Every `b` is called on an object of another function too, so `this` is any of them.
function askAcross(label, method) {
  var answers = [];
  for (var index = 0; index < made.length; index++)
    answers.push(method.call(made[index], index));
  lines.push(label + " " + answers.join(" "));
}
made.push(new F0(0));
made.push(new F1(1));
made.push(new F2(2));
made.push(new F3(3));
made.push(new F4(4));
made.push(new F5(5));
askAll("after F5");
made.push(new F6(6));
made.push(new F7(7));
made.push(new F8(8));
made.push(new F9(9));
made.push(new F10(10));
made.push(new F11(11));
askAll("after F11");
made.push(new F12(12));
made.push(new F13(13));
made.push(new F14(14));
made.push(new F15(15));
made.push(new F16(16));
made.push(new F17(17));
askAll("after F17");
made.push(new F18(18));
made.push(new F19(19));
// Members of functions that were constructed early change while most of the others have not been constructed yet.
var kept3 = F3.prototype.a;
unseen(F3).prototype.a = function (x) { return "replaced3:" + x; };
delete unseen(F7).prototype.a;
Object.setPrototypeOf(unseen(F7).prototype, { a: function (x) { return "above7:" + x; } });
Object.defineProperty(unseen(F11).prototype, "c", { get: function () { return function () { return "got11"; }; }, configurable: true });
askAll("three changed");
askAcross("across by F0", F0.prototype.b);
// The rest is constructed from the last to the first, and one that has not been constructed yet changes on the way.
made.push(new F47(47));
made.push(new F46(46));
made.push(new F45(45));
made.push(new F44(44));
made.push(new F43(43));
made.push(new F42(42));
made.push(new F41(41));
askAll("after F41");
made.push(new F40(40));
made.push(new F39(39));
made.push(new F38(38));
made.push(new F37(37));
made.push(new F36(36));
made.push(new F35(35));
made.push(new F34(34));
askAll("after F34");
made.push(new F33(33));
made.push(new F32(32));
made.push(new F31(31));
unseen(F25).prototype.a = function (x) { return "early25:" + x; };
unseen(F1).prototype.c = function () { return "late1"; };
made.push(new F30(30));
made.push(new F29(29));
made.push(new F28(28));
made.push(new F27(27));
askAll("after F27");
made.push(new F26(26));
made.push(new F25(25));
made.push(new F24(24));
made.push(new F23(23));
made.push(new F22(22));
made.push(new F21(21));
made.push(new F20(20));
askAll("after F20");
askAll("all made");
askAcross("across by F47", F47.prototype.b);
askAcross("across by F25", F25.prototype.b);
unseen(F3).prototype.a = kept3;
askAll("F3 put back");
unseen(F46).prototype.a = function (x) { return "last:" + x; };
unseen(F0).prototype.a = function (x) { return "first:" + x; };
askAll("the ends changed");
askAcross("across by F12", F12.prototype.b);

// One method above many functions: one site, one callee, and a condition for each of the functions. A late one stands in the way, then an early one too, then the late one is repaired.
function GBase() {}
GBase.prototype.who = function () { return "base"; };
GBase.prototype.size = 1;
function G0() { this.n = 0; }
Object.setPrototypeOf(G0.prototype, GBase.prototype);
function G1() { this.n = 1; }
Object.setPrototypeOf(G1.prototype, GBase.prototype);
function G2() { this.n = 2; }
Object.setPrototypeOf(G2.prototype, GBase.prototype);
function G3() { this.n = 3; }
Object.setPrototypeOf(G3.prototype, GBase.prototype);
function G4() { this.n = 4; }
Object.setPrototypeOf(G4.prototype, GBase.prototype);
function G5() { this.n = 5; }
Object.setPrototypeOf(G5.prototype, GBase.prototype);
function G6() { this.n = 6; }
Object.setPrototypeOf(G6.prototype, GBase.prototype);
function G7() { this.n = 7; }
Object.setPrototypeOf(G7.prototype, GBase.prototype);
function G8() { this.n = 8; }
Object.setPrototypeOf(G8.prototype, GBase.prototype);
function G9() { this.n = 9; }
Object.setPrototypeOf(G9.prototype, GBase.prototype);
function G10() { this.n = 10; }
Object.setPrototypeOf(G10.prototype, GBase.prototype);
function G11() { this.n = 11; }
Object.setPrototypeOf(G11.prototype, GBase.prototype);
function G12() { this.n = 12; }
Object.setPrototypeOf(G12.prototype, GBase.prototype);
function G13() { this.n = 13; }
Object.setPrototypeOf(G13.prototype, GBase.prototype);
function G14() { this.n = 14; }
Object.setPrototypeOf(G14.prototype, GBase.prototype);
function G15() { this.n = 15; }
Object.setPrototypeOf(G15.prototype, GBase.prototype);
function G16() { this.n = 16; }
Object.setPrototypeOf(G16.prototype, GBase.prototype);
function G17() { this.n = 17; }
Object.setPrototypeOf(G17.prototype, GBase.prototype);
function G18() { this.n = 18; }
Object.setPrototypeOf(G18.prototype, GBase.prototype);
function G19() { this.n = 19; }
Object.setPrototypeOf(G19.prototype, GBase.prototype);
function G20() { this.n = 20; }
Object.setPrototypeOf(G20.prototype, GBase.prototype);
function G21() { this.n = 21; }
Object.setPrototypeOf(G21.prototype, GBase.prototype);
function G22() { this.n = 22; }
Object.setPrototypeOf(G22.prototype, GBase.prototype);
function G23() { this.n = 23; }
Object.setPrototypeOf(G23.prototype, GBase.prototype);
function G24() { this.n = 24; }
Object.setPrototypeOf(G24.prototype, GBase.prototype);
function G25() { this.n = 25; }
Object.setPrototypeOf(G25.prototype, GBase.prototype);
function G26() { this.n = 26; }
Object.setPrototypeOf(G26.prototype, GBase.prototype);
function G27() { this.n = 27; }
Object.setPrototypeOf(G27.prototype, GBase.prototype);
var allG = [];
function askG(label) {
  var answers = [];
  for (var index = 0; index < allG.length; index++)
    answers.push(allG[index].who() + allG[index].size);
  lines.push("G " + label + " " + answers.join(" "));
}
unseen(G25).prototype.who = function () { return "late"; };
allG.push(new G0());
allG.push(new G1());
allG.push(new G2());
allG.push(new G3());
allG.push(new G4());
allG.push(new G5());
askG("six");
allG.push(new G25());
askG("with the late one");
allG.push(new G6());
allG.push(new G7());
allG.push(new G8());
allG.push(new G9());
allG.push(new G10());
allG.push(new G11());
askG("twelve");
unseen(G1).prototype.who = function () { return "early"; };
askG("an early one too");
delete unseen(G25).prototype.who;
askG("the late one repaired");
allG.push(new G12());
allG.push(new G13());
allG.push(new G14());
allG.push(new G15());
allG.push(new G16());
allG.push(new G17());
allG.push(new G18());
allG.push(new G19());
allG.push(new G20());
allG.push(new G21());
allG.push(new G22());
allG.push(new G23());
allG.push(new G24());
allG.push(new G26());
allG.push(new G27());
askG("all");
delete unseen(G1).prototype.who;
askG("both repaired");
Object.defineProperty(unseen(G27).prototype, "size", { value: 9, configurable: true });
unseen(G2).prototype.who = function () { return "second"; };
askG("the last and the third");
delete unseen(G27).prototype.size;
askG("the last repaired");
unseen(GBase).prototype.who = function () { return "BASE"; };
askG("the one above changed");
class HBase { who() { return "base"; } get size() { return 1; } }
class H0 extends HBase { constructor() { super(); this.n = 0; } }
class H1 extends HBase { constructor() { super(); this.n = 1; } }
class H2 extends HBase { constructor() { super(); this.n = 2; } }
class H3 extends HBase { constructor() { super(); this.n = 3; } }
class H4 extends HBase { constructor() { super(); this.n = 4; } }
class H5 extends HBase { constructor() { super(); this.n = 5; } }
class H6 extends HBase { constructor() { super(); this.n = 6; } }
class H7 extends HBase { constructor() { super(); this.n = 7; } }
class H8 extends HBase { constructor() { super(); this.n = 8; } }
class H9 extends HBase { constructor() { super(); this.n = 9; } }
class H10 extends HBase { constructor() { super(); this.n = 10; } }
class H11 extends HBase { constructor() { super(); this.n = 11; } }
class H12 extends HBase { constructor() { super(); this.n = 12; } }
class H13 extends HBase { constructor() { super(); this.n = 13; } }
class H14 extends HBase { constructor() { super(); this.n = 14; } }
class H15 extends HBase { constructor() { super(); this.n = 15; } }
class H16 extends HBase { constructor() { super(); this.n = 16; } }
class H17 extends HBase { constructor() { super(); this.n = 17; } }
class H18 extends HBase { constructor() { super(); this.n = 18; } }
class H19 extends HBase { constructor() { super(); this.n = 19; } }
class H20 extends HBase { constructor() { super(); this.n = 20; } }
class H21 extends HBase { constructor() { super(); this.n = 21; } }
class H22 extends HBase { constructor() { super(); this.n = 22; } }
class H23 extends HBase { constructor() { super(); this.n = 23; } }
class H24 extends HBase { constructor() { super(); this.n = 24; } }
class H25 extends HBase { constructor() { super(); this.n = 25; } }
class H26 extends HBase { constructor() { super(); this.n = 26; } }
class H27 extends HBase { constructor() { super(); this.n = 27; } }
var allH = [];
function askH(label) {
  var answers = [];
  for (var index = 0; index < allH.length; index++)
    answers.push(allH[index].who() + allH[index].size);
  lines.push("H " + label + " " + answers.join(" "));
}
unseen(H25).prototype.who = function () { return "late"; };
allH.push(new H0());
allH.push(new H1());
allH.push(new H2());
allH.push(new H3());
allH.push(new H4());
allH.push(new H5());
askH("six");
allH.push(new H25());
askH("with the late one");
allH.push(new H6());
allH.push(new H7());
allH.push(new H8());
allH.push(new H9());
allH.push(new H10());
allH.push(new H11());
askH("twelve");
unseen(H1).prototype.who = function () { return "early"; };
askH("an early one too");
delete unseen(H25).prototype.who;
askH("the late one repaired");
allH.push(new H12());
allH.push(new H13());
allH.push(new H14());
allH.push(new H15());
allH.push(new H16());
allH.push(new H17());
allH.push(new H18());
allH.push(new H19());
allH.push(new H20());
allH.push(new H21());
allH.push(new H22());
allH.push(new H23());
allH.push(new H24());
allH.push(new H26());
allH.push(new H27());
askH("all");
delete unseen(H1).prototype.who;
askH("both repaired");
Object.defineProperty(unseen(H27).prototype, "size", { value: 9, configurable: true });
unseen(H2).prototype.who = function () { return "second"; };
askH("the last and the third");
delete unseen(H27).prototype.size;
askH("the last repaired");
unseen(HBase).prototype.who = function () { return "BASE"; };
askH("the one above changed");
console.log(lines.join("\n"));
