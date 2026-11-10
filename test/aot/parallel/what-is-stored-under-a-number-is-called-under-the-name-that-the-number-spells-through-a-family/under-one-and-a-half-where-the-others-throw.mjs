class Base { tag() { return 0; } }
class H0 extends Base { m0() { return 0; } }
class H1 extends Base { m1() { return 1; } }
class H2 extends Base { m2() { return 2; } }
class H3 extends Base { m3() { return 3; } }
class H4 extends Base { m4() { return 4; } }
class H5 extends Base { m5() { return 5; } }
class H6 extends Base { m6() { return 6; } }
class H7 extends Base { m7() { return 7; } }
class H8 extends Base { m8() { return 8; } }
class H9 extends Base { m9() { return 9; } }
class H10 extends Base { m10() { return 10; } }
class H11 extends Base { m11() { return 11; } }
class H12 extends Base { m12() { return 12; } }
class H13 extends Base { m13() { return 13; } }
class H14 extends Base { m14() { return 14; } }
class H15 extends Base { m15() { return 15; } }
class H16 extends Base { m16() { return 16; } }
class H17 extends Base { m17() { return 17; } }
class H18 extends Base { m18() { return 18; } }
class H19 extends Base { m19() { return 19; } }
class H20 extends Base { m20() { return 20; } }
class H21 extends Base { m21() { return 21; } }
class H22 extends Base { m22() { return 22; } }
class H23 extends Base { m23() { return 23; } }
class H24 extends Base { m24() { return 24; } }
class H25 extends Base { m25() { return 25; } }
class H26 extends Base { m26() { return 26; } }
class H27 extends Base { m27() { return 27; } }
class H28 extends Base { m28() { return 28; } }
class H29 extends Base { m29() { return 29; } }
class H30 extends Base { m30() { return 30; } }
class H31 extends Base { m31() { return 31; } }
class H32 extends Base { m32() { return 32; } }
class H33 extends Base { m33() { return 33; } }
class H34 extends Base { m34() { return 34; } }
class H35 extends Base { m35() { return 35; } }
class H36 extends Base { m36() { return 36; } }
class H37 extends Base { m37() { return 37; } }
class H38 extends Base { m38() { return 38; } }
class H39 extends Base { m39() { return 39; } }
const all = [
  new H0(),
  new H1(),
  new H2(),
  new H3(),
  new H4(),
  new H5(),
  new H6(),
  new H7(),
  new H8(),
  new H9(),
  new H10(),
  new H11(),
  new H12(),
  new H13(),
  new H14(),
  new H15(),
  new H16(),
  new H17(),
  new H18(),
  new H19(),
  new H20(),
  new H21(),
  new H22(),
  new H23(),
  new H24(),
  new H25(),
  new H26(),
  new H27(),
  new H28(),
  new H29(),
  new H30(),
  new H31(),
  new H32(),
  new H33(),
  new H34(),
  new H35(),
  new H36(),
  new H37(),
  new H38(),
  new H39(),
];
const key = Number(JSON.parse("1.5"));
all[3][key] = function () { return 77; };
function call(x) { try { return x["1.5"](); } catch (error) { return error.name; } }
const said = new Set();
for (const x of all) said.add(call(x));
console.log("SAID", [...said].sort().join(" "));
