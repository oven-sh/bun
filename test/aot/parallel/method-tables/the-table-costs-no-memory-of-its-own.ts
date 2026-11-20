// The table through which compiled code calls a method that several classes declare is read out of the program's own file: no read-only pages are filled with a copy of it.
// Env of the build: BUN_AOT_WRITES_PROGRAM_ALONE=0
import { readFileSync } from "node:fs";
class Base {
  weight = 1;
  m0(k: number): number { return this.weight + k + 0; }
  m1(k: number): number { return this.weight + k + 1; }
  m2(k: number): number { return this.weight + k + 2; }
  m3(k: number): number { return this.weight + k + 3; }
  m4(k: number): number { return this.weight + k + 4; }
  m5(k: number): number { return this.weight + k + 5; }
  m6(k: number): number { return this.weight + k + 6; }
  m7(k: number): number { return this.weight + k + 7; }
  m8(k: number): number { return this.weight + k + 8; }
  m9(k: number): number { return this.weight + k + 9; }
  m10(k: number): number { return this.weight + k + 10; }
  m11(k: number): number { return this.weight + k + 11; }
  m12(k: number): number { return this.weight + k + 12; }
  m13(k: number): number { return this.weight + k + 13; }
  m14(k: number): number { return this.weight + k + 14; }
  m15(k: number): number { return this.weight + k + 15; }
  m16(k: number): number { return this.weight + k + 16; }
  m17(k: number): number { return this.weight + k + 17; }
  m18(k: number): number { return this.weight + k + 18; }
  m19(k: number): number { return this.weight + k + 19; }
  m20(k: number): number { return this.weight + k + 20; }
  m21(k: number): number { return this.weight + k + 21; }
  m22(k: number): number { return this.weight + k + 22; }
  m23(k: number): number { return this.weight + k + 23; }
  m24(k: number): number { return this.weight + k + 24; }
  m25(k: number): number { return this.weight + k + 25; }
  m26(k: number): number { return this.weight + k + 26; }
  m27(k: number): number { return this.weight + k + 27; }
  m28(k: number): number { return this.weight + k + 28; }
  m29(k: number): number { return this.weight + k + 29; }
  m30(k: number): number { return this.weight + k + 30; }
  m31(k: number): number { return this.weight + k + 31; }
  m32(k: number): number { return this.weight + k + 32; }
  m33(k: number): number { return this.weight + k + 33; }
  m34(k: number): number { return this.weight + k + 34; }
  m35(k: number): number { return this.weight + k + 35; }
  m36(k: number): number { return this.weight + k + 36; }
  m37(k: number): number { return this.weight + k + 37; }
  m38(k: number): number { return this.weight + k + 38; }
  m39(k: number): number { return this.weight + k + 39; }
  m40(k: number): number { return this.weight + k + 40; }
  m41(k: number): number { return this.weight + k + 41; }
  m42(k: number): number { return this.weight + k + 42; }
  m43(k: number): number { return this.weight + k + 43; }
  m44(k: number): number { return this.weight + k + 44; }
  m45(k: number): number { return this.weight + k + 45; }
  m46(k: number): number { return this.weight + k + 46; }
  m47(k: number): number { return this.weight + k + 47; }
  m48(k: number): number { return this.weight + k + 48; }
  m49(k: number): number { return this.weight + k + 49; }
  m50(k: number): number { return this.weight + k + 50; }
  m51(k: number): number { return this.weight + k + 51; }
  m52(k: number): number { return this.weight + k + 52; }
  m53(k: number): number { return this.weight + k + 53; }
  m54(k: number): number { return this.weight + k + 54; }
  m55(k: number): number { return this.weight + k + 55; }
  m56(k: number): number { return this.weight + k + 56; }
  m57(k: number): number { return this.weight + k + 57; }
  m58(k: number): number { return this.weight + k + 58; }
  m59(k: number): number { return this.weight + k + 59; }
}
class Other extends Base {
  m0(k: number): number { return this.weight * 2 + k + 0; }
  m1(k: number): number { return this.weight * 2 + k + 1; }
  m2(k: number): number { return this.weight * 2 + k + 2; }
  m3(k: number): number { return this.weight * 2 + k + 3; }
  m4(k: number): number { return this.weight * 2 + k + 4; }
  m5(k: number): number { return this.weight * 2 + k + 5; }
  m6(k: number): number { return this.weight * 2 + k + 6; }
  m7(k: number): number { return this.weight * 2 + k + 7; }
  m8(k: number): number { return this.weight * 2 + k + 8; }
  m9(k: number): number { return this.weight * 2 + k + 9; }
  m10(k: number): number { return this.weight * 2 + k + 10; }
  m11(k: number): number { return this.weight * 2 + k + 11; }
  m12(k: number): number { return this.weight * 2 + k + 12; }
  m13(k: number): number { return this.weight * 2 + k + 13; }
  m14(k: number): number { return this.weight * 2 + k + 14; }
  m15(k: number): number { return this.weight * 2 + k + 15; }
  m16(k: number): number { return this.weight * 2 + k + 16; }
  m17(k: number): number { return this.weight * 2 + k + 17; }
  m18(k: number): number { return this.weight * 2 + k + 18; }
  m19(k: number): number { return this.weight * 2 + k + 19; }
  m20(k: number): number { return this.weight * 2 + k + 20; }
  m21(k: number): number { return this.weight * 2 + k + 21; }
  m22(k: number): number { return this.weight * 2 + k + 22; }
  m23(k: number): number { return this.weight * 2 + k + 23; }
  m24(k: number): number { return this.weight * 2 + k + 24; }
  m25(k: number): number { return this.weight * 2 + k + 25; }
  m26(k: number): number { return this.weight * 2 + k + 26; }
  m27(k: number): number { return this.weight * 2 + k + 27; }
  m28(k: number): number { return this.weight * 2 + k + 28; }
  m29(k: number): number { return this.weight * 2 + k + 29; }
  m30(k: number): number { return this.weight * 2 + k + 30; }
  m31(k: number): number { return this.weight * 2 + k + 31; }
  m32(k: number): number { return this.weight * 2 + k + 32; }
  m33(k: number): number { return this.weight * 2 + k + 33; }
  m34(k: number): number { return this.weight * 2 + k + 34; }
  m35(k: number): number { return this.weight * 2 + k + 35; }
  m36(k: number): number { return this.weight * 2 + k + 36; }
  m37(k: number): number { return this.weight * 2 + k + 37; }
  m38(k: number): number { return this.weight * 2 + k + 38; }
  m39(k: number): number { return this.weight * 2 + k + 39; }
  m40(k: number): number { return this.weight * 2 + k + 40; }
  m41(k: number): number { return this.weight * 2 + k + 41; }
  m42(k: number): number { return this.weight * 2 + k + 42; }
  m43(k: number): number { return this.weight * 2 + k + 43; }
  m44(k: number): number { return this.weight * 2 + k + 44; }
  m45(k: number): number { return this.weight * 2 + k + 45; }
  m46(k: number): number { return this.weight * 2 + k + 46; }
  m47(k: number): number { return this.weight * 2 + k + 47; }
  m48(k: number): number { return this.weight * 2 + k + 48; }
  m49(k: number): number { return this.weight * 2 + k + 49; }
  m50(k: number): number { return this.weight * 2 + k + 50; }
  m51(k: number): number { return this.weight * 2 + k + 51; }
  m52(k: number): number { return this.weight * 2 + k + 52; }
  m53(k: number): number { return this.weight * 2 + k + 53; }
  m54(k: number): number { return this.weight * 2 + k + 54; }
  m55(k: number): number { return this.weight * 2 + k + 55; }
  m56(k: number): number { return this.weight * 2 + k + 56; }
  m57(k: number): number { return this.weight * 2 + k + 57; }
  m58(k: number): number { return this.weight * 2 + k + 58; }
  m59(k: number): number { return this.weight * 2 + k + 59; }
}
class Heir0 extends Base {} class Heir1 extends Base {} class Heir2 extends Base {} class Heir3 extends Base {} class Heir4 extends Base {} class Heir5 extends Base {} class Heir6 extends Base {} class Heir7 extends Base {} class Heir8 extends Base {} class Heir9 extends Base {}
class Heir10 extends Base {} class Heir11 extends Base {} class Heir12 extends Base {} class Heir13 extends Base {} class Heir14 extends Base {} class Heir15 extends Base {} class Heir16 extends Base {} class Heir17 extends Base {} class Heir18 extends Base {} class Heir19 extends Base {}
class Heir20 extends Base {} class Heir21 extends Base {} class Heir22 extends Base {} class Heir23 extends Base {} class Heir24 extends Base {} class Heir25 extends Base {} class Heir26 extends Base {} class Heir27 extends Base {} class Heir28 extends Base {} class Heir29 extends Base {}
class Heir30 extends Base {} class Heir31 extends Base {} class Heir32 extends Base {} class Heir33 extends Base {} class Heir34 extends Base {} class Heir35 extends Base {} class Heir36 extends Base {} class Heir37 extends Base {} class Heir38 extends Base {} class Heir39 extends Base {}
class Heir40 extends Base {} class Heir41 extends Base {} class Heir42 extends Base {} class Heir43 extends Base {} class Heir44 extends Base {} class Heir45 extends Base {} class Heir46 extends Base {} class Heir47 extends Base {} class Heir48 extends Base {} class Heir49 extends Base {}
class Heir50 extends Base {} class Heir51 extends Base {} class Heir52 extends Base {} class Heir53 extends Base {} class Heir54 extends Base {} class Heir55 extends Base {} class Heir56 extends Base {} class Heir57 extends Base {} class Heir58 extends Base {} class Heir59 extends Base {}
class Heir60 extends Base {} class Heir61 extends Base {} class Heir62 extends Base {} class Heir63 extends Base {} class Heir64 extends Base {} class Heir65 extends Base {} class Heir66 extends Base {} class Heir67 extends Base {} class Heir68 extends Base {} class Heir69 extends Base {}
class Heir70 extends Base {} class Heir71 extends Base {} class Heir72 extends Base {} class Heir73 extends Base {} class Heir74 extends Base {} class Heir75 extends Base {} class Heir76 extends Base {} class Heir77 extends Base {} class Heir78 extends Base {} class Heir79 extends Base {}
class Heir80 extends Base {} class Heir81 extends Base {} class Heir82 extends Base {} class Heir83 extends Base {} class Heir84 extends Base {} class Heir85 extends Base {} class Heir86 extends Base {} class Heir87 extends Base {} class Heir88 extends Base {} class Heir89 extends Base {}
class Heir90 extends Base {} class Heir91 extends Base {} class Heir92 extends Base {} class Heir93 extends Base {} class Heir94 extends Base {} class Heir95 extends Base {} class Heir96 extends Base {} class Heir97 extends Base {} class Heir98 extends Base {} class Heir99 extends Base {}
class Heir100 extends Base {} class Heir101 extends Base {} class Heir102 extends Base {} class Heir103 extends Base {} class Heir104 extends Base {} class Heir105 extends Base {} class Heir106 extends Base {} class Heir107 extends Base {} class Heir108 extends Base {} class Heir109 extends Base {}
class Heir110 extends Base {} class Heir111 extends Base {} class Heir112 extends Base {} class Heir113 extends Base {} class Heir114 extends Base {} class Heir115 extends Base {} class Heir116 extends Base {} class Heir117 extends Base {} class Heir118 extends Base {} class Heir119 extends Base {}
class Heir120 extends Base {} class Heir121 extends Base {} class Heir122 extends Base {} class Heir123 extends Base {} class Heir124 extends Base {} class Heir125 extends Base {} class Heir126 extends Base {} class Heir127 extends Base {} class Heir128 extends Base {} class Heir129 extends Base {}
class Heir130 extends Base {} class Heir131 extends Base {} class Heir132 extends Base {} class Heir133 extends Base {} class Heir134 extends Base {} class Heir135 extends Base {} class Heir136 extends Base {} class Heir137 extends Base {} class Heir138 extends Base {} class Heir139 extends Base {}
class Heir140 extends Base {} class Heir141 extends Base {} class Heir142 extends Base {} class Heir143 extends Base {} class Heir144 extends Base {} class Heir145 extends Base {} class Heir146 extends Base {} class Heir147 extends Base {} class Heir148 extends Base {} class Heir149 extends Base {}
class Heir150 extends Base {} class Heir151 extends Base {} class Heir152 extends Base {} class Heir153 extends Base {} class Heir154 extends Base {} class Heir155 extends Base {} class Heir156 extends Base {} class Heir157 extends Base {} class Heir158 extends Base {} class Heir159 extends Base {}
class Heir160 extends Base {} class Heir161 extends Base {} class Heir162 extends Base {} class Heir163 extends Base {} class Heir164 extends Base {} class Heir165 extends Base {} class Heir166 extends Base {} class Heir167 extends Base {} class Heir168 extends Base {} class Heir169 extends Base {}
class Heir170 extends Base {} class Heir171 extends Base {} class Heir172 extends Base {} class Heir173 extends Base {} class Heir174 extends Base {} class Heir175 extends Base {} class Heir176 extends Base {} class Heir177 extends Base {} class Heir178 extends Base {} class Heir179 extends Base {}
class Heir180 extends Base {} class Heir181 extends Base {} class Heir182 extends Base {} class Heir183 extends Base {} class Heir184 extends Base {} class Heir185 extends Base {} class Heir186 extends Base {} class Heir187 extends Base {} class Heir188 extends Base {} class Heir189 extends Base {}
class Heir190 extends Base {} class Heir191 extends Base {} class Heir192 extends Base {} class Heir193 extends Base {} class Heir194 extends Base {} class Heir195 extends Base {} class Heir196 extends Base {} class Heir197 extends Base {} class Heir198 extends Base {} class Heir199 extends Base {}
const all: Base[] = [new Base(), new Other(),
  new Heir0(), new Heir1(), new Heir2(), new Heir3(), new Heir4(), new Heir5(), new Heir6(), new Heir7(), new Heir8(), new Heir9(),
  new Heir10(), new Heir11(), new Heir12(), new Heir13(), new Heir14(), new Heir15(), new Heir16(), new Heir17(), new Heir18(), new Heir19(),
  new Heir20(), new Heir21(), new Heir22(), new Heir23(), new Heir24(), new Heir25(), new Heir26(), new Heir27(), new Heir28(), new Heir29(),
  new Heir30(), new Heir31(), new Heir32(), new Heir33(), new Heir34(), new Heir35(), new Heir36(), new Heir37(), new Heir38(), new Heir39(),
  new Heir40(), new Heir41(), new Heir42(), new Heir43(), new Heir44(), new Heir45(), new Heir46(), new Heir47(), new Heir48(), new Heir49(),
  new Heir50(), new Heir51(), new Heir52(), new Heir53(), new Heir54(), new Heir55(), new Heir56(), new Heir57(), new Heir58(), new Heir59(),
  new Heir60(), new Heir61(), new Heir62(), new Heir63(), new Heir64(), new Heir65(), new Heir66(), new Heir67(), new Heir68(), new Heir69(),
  new Heir70(), new Heir71(), new Heir72(), new Heir73(), new Heir74(), new Heir75(), new Heir76(), new Heir77(), new Heir78(), new Heir79(),
  new Heir80(), new Heir81(), new Heir82(), new Heir83(), new Heir84(), new Heir85(), new Heir86(), new Heir87(), new Heir88(), new Heir89(),
  new Heir90(), new Heir91(), new Heir92(), new Heir93(), new Heir94(), new Heir95(), new Heir96(), new Heir97(), new Heir98(), new Heir99(),
  new Heir100(), new Heir101(), new Heir102(), new Heir103(), new Heir104(), new Heir105(), new Heir106(), new Heir107(), new Heir108(), new Heir109(),
  new Heir110(), new Heir111(), new Heir112(), new Heir113(), new Heir114(), new Heir115(), new Heir116(), new Heir117(), new Heir118(), new Heir119(),
  new Heir120(), new Heir121(), new Heir122(), new Heir123(), new Heir124(), new Heir125(), new Heir126(), new Heir127(), new Heir128(), new Heir129(),
  new Heir130(), new Heir131(), new Heir132(), new Heir133(), new Heir134(), new Heir135(), new Heir136(), new Heir137(), new Heir138(), new Heir139(),
  new Heir140(), new Heir141(), new Heir142(), new Heir143(), new Heir144(), new Heir145(), new Heir146(), new Heir147(), new Heir148(), new Heir149(),
  new Heir150(), new Heir151(), new Heir152(), new Heir153(), new Heir154(), new Heir155(), new Heir156(), new Heir157(), new Heir158(), new Heir159(),
  new Heir160(), new Heir161(), new Heir162(), new Heir163(), new Heir164(), new Heir165(), new Heir166(), new Heir167(), new Heir168(), new Heir169(),
  new Heir170(), new Heir171(), new Heir172(), new Heir173(), new Heir174(), new Heir175(), new Heir176(), new Heir177(), new Heir178(), new Heir179(),
  new Heir180(), new Heir181(), new Heir182(), new Heir183(), new Heir184(), new Heir185(), new Heir186(), new Heir187(), new Heir188(), new Heir189(),
  new Heir190(), new Heir191(), new Heir192(), new Heir193(), new Heir194(), new Heir195(), new Heir196(), new Heir197(), new Heir198(), new Heir199(),
];
function measure(): number {
  let sum = 0;
  for (const one of all) sum += one.m0(1) + one.m1(1) + one.m2(1) + one.m3(1) + one.m4(1) + one.m5(1) + one.m6(1) + one.m7(1) + one.m8(1) + one.m9(1) + one.m10(1) + one.m11(1) + one.m12(1) + one.m13(1) + one.m14(1) + one.m15(1) + one.m16(1) + one.m17(1) + one.m18(1) + one.m19(1) + one.m20(1) + one.m21(1) + one.m22(1) + one.m23(1) + one.m24(1) + one.m25(1) + one.m26(1) + one.m27(1) + one.m28(1) + one.m29(1) + one.m30(1) + one.m31(1) + one.m32(1) + one.m33(1) + one.m34(1) + one.m35(1) + one.m36(1) + one.m37(1) + one.m38(1) + one.m39(1) + one.m40(1) + one.m41(1) + one.m42(1) + one.m43(1) + one.m44(1) + one.m45(1) + one.m46(1) + one.m47(1) + one.m48(1) + one.m49(1) + one.m50(1) + one.m51(1) + one.m52(1) + one.m53(1) + one.m54(1) + one.m55(1) + one.m56(1) + one.m57(1) + one.m58(1) + one.m59(1);
  return sum;
}
function readOnlyPagesOfItsOwn(): string {
  let mappings: string;
  try {
    mappings = readFileSync("/proc/self/smaps", "utf8");
  } catch {
    return "none";
  }
  let head = "";
  const found: string[] = [];
  for (const line of mappings.split("\n")) {
    if (/^[0-9a-f]+-[0-9a-f]+ /.test(line)) head = line;
    else if (line.startsWith("Anonymous:") && parseInt(line.slice(10)) >= least) {
      const [, access, , , , file] = head.split(/\s+/);
      if (access === "r--p" && !file) found.push(line.slice(10).trim());
    }
  }
  return found.join(", ") || "none";
}
const least = Number(process.argv[2] ?? 32);
console.log(measure(), readOnlyPagesOfItsOwn());
(Base.prototype as any).m7 = function (k: number) { return 1000 + k; };
console.log(measure(), readOnlyPagesOfItsOwn());
