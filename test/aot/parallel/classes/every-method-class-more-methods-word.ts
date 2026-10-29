// A class with more methods than a word has bits, and a subclass that overrides each. Calls through the typed parameter find the method by the object's class.
// Then every method of the base is replaced, one after the other: each call finds the new function from then on, and the subclass keeps its own.
class Base {
  m00() { return 0; } m01() { return 1; } m02() { return 2; } m03() { return 3; } m04() { return 4; }
  m05() { return 5; } m06() { return 6; } m07() { return 7; } m08() { return 8; } m09() { return 9; }
  m10() { return 10; } m11() { return 11; } m12() { return 12; } m13() { return 13; } m14() { return 14; }
  m15() { return 15; } m16() { return 16; } m17() { return 17; } m18() { return 18; } m19() { return 19; }
  m20() { return 20; } m21() { return 21; } m22() { return 22; } m23() { return 23; } m24() { return 24; }
  m25() { return 25; } m26() { return 26; } m27() { return 27; } m28() { return 28; } m29() { return 29; }
  m30() { return 30; } m31() { return 31; } m32() { return 32; } m33() { return 33; } m34() { return 34; }
  m35() { return 35; } m36() { return 36; } m37() { return 37; } m38() { return 38; } m39() { return 39; }
  m40() { return 40; } m41() { return 41; } m42() { return 42; } m43() { return 43; } m44() { return 44; }
  m45() { return 45; } m46() { return 46; } m47() { return 47; } m48() { return 48; } m49() { return 49; }
  m50() { return 50; } m51() { return 51; } m52() { return 52; } m53() { return 53; } m54() { return 54; }
  m55() { return 55; } m56() { return 56; } m57() { return 57; } m58() { return 58; } m59() { return 59; }
  m60() { return 60; } m61() { return 61; } m62() { return 62; } m63() { return 63; } m64() { return 64; }
  m65() { return 65; } m66() { return 66; } m67() { return 67; } m68() { return 68; } m69() { return 69; }
}
class Derived extends Base {
  m00() { return 100; } m01() { return 101; } m02() { return 102; } m03() { return 103; } m04() { return 104; }
  m05() { return 105; } m06() { return 106; } m07() { return 107; } m08() { return 108; } m09() { return 109; }
  m10() { return 110; } m11() { return 111; } m12() { return 112; } m13() { return 113; } m14() { return 114; }
  m15() { return 115; } m16() { return 116; } m17() { return 117; } m18() { return 118; } m19() { return 119; }
  m20() { return 120; } m21() { return 121; } m22() { return 122; } m23() { return 123; } m24() { return 124; }
  m25() { return 125; } m26() { return 126; } m27() { return 127; } m28() { return 128; } m29() { return 129; }
  m30() { return 130; } m31() { return 131; } m32() { return 132; } m33() { return 133; } m34() { return 134; }
  m35() { return 135; } m36() { return 136; } m37() { return 137; } m38() { return 138; } m39() { return 139; }
  m40() { return 140; } m41() { return 141; } m42() { return 142; } m43() { return 143; } m44() { return 144; }
  m45() { return 145; } m46() { return 146; } m47() { return 147; } m48() { return 148; } m49() { return 149; }
  m50() { return 150; } m51() { return 151; } m52() { return 152; } m53() { return 153; } m54() { return 154; }
  m55() { return 155; } m56() { return 156; } m57() { return 157; } m58() { return 158; } m59() { return 159; }
  m60() { return 160; } m61() { return 161; } m62() { return 162; } m63() { return 163; } m64() { return 164; }
  m65() { return 165; } m66() { return 166; } m67() { return 167; } m68() { return 168; } m69() { return 169; }
}
function each(o: Base): number[] {
  return [
    o.m00(), o.m01(), o.m02(), o.m03(), o.m04(), o.m05(), o.m06(), o.m07(), o.m08(), o.m09(),
    o.m10(), o.m11(), o.m12(), o.m13(), o.m14(), o.m15(), o.m16(), o.m17(), o.m18(), o.m19(),
    o.m20(), o.m21(), o.m22(), o.m23(), o.m24(), o.m25(), o.m26(), o.m27(), o.m28(), o.m29(),
    o.m30(), o.m31(), o.m32(), o.m33(), o.m34(), o.m35(), o.m36(), o.m37(), o.m38(), o.m39(),
    o.m40(), o.m41(), o.m42(), o.m43(), o.m44(), o.m45(), o.m46(), o.m47(), o.m48(), o.m49(),
    o.m50(), o.m51(), o.m52(), o.m53(), o.m54(), o.m55(), o.m56(), o.m57(), o.m58(), o.m59(),
    o.m60(), o.m61(), o.m62(), o.m63(), o.m64(), o.m65(), o.m66(), o.m67(), o.m68(), o.m69(),
  ];
}
const objects: Base[] = [new Base(), new Derived()];
const show = (label: string) => console.log(label, objects.map(o => each(o).join(",")).join(" | "));
for (let round = 0; round < 3; round++) show("as written");
const names = Object.getOwnPropertyNames(Base.prototype).filter(name => name !== "constructor");
for (const [index, name] of names.entries()) {
  (Base.prototype as any)[name] = () => -1 - index;
  if (index % 23 === 0 || index >= 62) show("replaced up to " + name);
}
for (const name of names.filter((_, index) => index % 2 === 1)) delete (Derived.prototype as any)[name];
show("every second one of the subclass deleted");
