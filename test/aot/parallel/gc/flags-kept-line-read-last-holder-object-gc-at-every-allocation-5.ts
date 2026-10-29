// An object with very many optional flags keeps most of them out of line. Its last holder reads a few of those on every turn of a loop that also makes texts.
// Env: BUN_JSC_slowPathAllocsBetweenGCs=1
// Env: BUN_JSC_scribbleFreeCells=1
// Flags: --aot-testing=ForceGCSlowPaths
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
// Erased types: not built: flags-kept-line-read-last-holder-object is built so
interface Options { name: string; b000?: boolean; b001?: boolean; b002?: boolean; b003?: boolean; b004?: boolean; b005?: boolean; b006?: boolean; b007?: boolean; b008?: boolean; b009?: boolean; b010?: boolean; b011?: boolean; b012?: boolean; b013?: boolean; b014?: boolean; b015?: boolean; b016?: boolean; b017?: boolean; b018?: boolean; b019?: boolean; b020?: boolean; b021?: boolean; b022?: boolean; b023?: boolean; b024?: boolean; b025?: boolean; b026?: boolean; b027?: boolean; b028?: boolean; b029?: boolean; b030?: boolean; b031?: boolean; b032?: boolean; b033?: boolean; b034?: boolean; b035?: boolean; b036?: boolean; b037?: boolean; b038?: boolean; b039?: boolean; b040?: boolean; b041?: boolean; b042?: boolean; b043?: boolean; b044?: boolean; b045?: boolean; b046?: boolean; b047?: boolean; b048?: boolean; b049?: boolean; b050?: boolean; b051?: boolean; b052?: boolean; b053?: boolean; b054?: boolean; b055?: boolean; b056?: boolean; b057?: boolean; b058?: boolean; b059?: boolean; b060?: boolean; b061?: boolean; b062?: boolean; b063?: boolean; b064?: boolean; b065?: boolean; b066?: boolean; b067?: boolean; b068?: boolean; b069?: boolean; b070?: boolean; b071?: boolean; b072?: boolean; b073?: boolean; b074?: boolean; b075?: boolean; b076?: boolean; b077?: boolean; b078?: boolean; b079?: boolean; b080?: boolean; b081?: boolean; b082?: boolean; b083?: boolean; b084?: boolean; b085?: boolean; b086?: boolean; b087?: boolean; b088?: boolean; b089?: boolean; b090?: boolean; b091?: boolean; b092?: boolean; b093?: boolean; b094?: boolean; b095?: boolean; b096?: boolean; b097?: boolean; b098?: boolean; b099?: boolean; b100?: boolean; b101?: boolean; b102?: boolean; b103?: boolean; b104?: boolean; b105?: boolean; b106?: boolean; b107?: boolean; b108?: boolean; b109?: boolean; b110?: boolean; b111?: boolean; b112?: boolean; b113?: boolean; b114?: boolean; b115?: boolean; b116?: boolean; b117?: boolean; b118?: boolean; b119?: boolean; b120?: boolean; b121?: boolean; b122?: boolean; b123?: boolean; b124?: boolean; b125?: boolean; b126?: boolean; b127?: boolean; b128?: boolean; b129?: boolean; b130?: boolean; b131?: boolean; b132?: boolean; b133?: boolean; b134?: boolean; b135?: boolean; b136?: boolean; b137?: boolean; b138?: boolean; b139?: boolean; b140?: boolean; b141?: boolean; b142?: boolean; b143?: boolean; b144?: boolean; b145?: boolean; b146?: boolean; b147?: boolean; b148?: boolean; b149?: boolean; b150?: boolean; b151?: boolean; b152?: boolean; b153?: boolean; b154?: boolean; b155?: boolean; b156?: boolean; b157?: boolean; b158?: boolean; b159?: boolean; }
function make(i: number): Options {
  const next: Options = { name: "n" + i };
  switch (i % 16) {
    case 0: next.b000 = false; next.b016 = true; next.b032 = true; next.b048 = false; next.b064 = true; next.b080 = true; next.b096 = false; next.b112 = true; next.b128 = true; next.b144 = false; break;
    case 1: next.b001 = false; next.b017 = true; next.b033 = true; next.b049 = false; next.b065 = true; next.b081 = true; next.b097 = false; next.b113 = true; next.b129 = true; next.b145 = false; break;
    case 2: next.b002 = false; next.b018 = true; next.b034 = true; next.b050 = false; next.b066 = true; next.b082 = true; next.b098 = false; next.b114 = true; next.b130 = true; next.b146 = false; break;
    case 3: next.b003 = false; next.b019 = true; next.b035 = true; next.b051 = false; next.b067 = true; next.b083 = true; next.b099 = false; next.b115 = true; next.b131 = true; next.b147 = false; break;
    case 4: next.b004 = false; next.b020 = true; next.b036 = true; next.b052 = false; next.b068 = true; next.b084 = true; next.b100 = false; next.b116 = true; next.b132 = true; next.b148 = false; break;
    case 5: next.b005 = false; next.b021 = true; next.b037 = true; next.b053 = false; next.b069 = true; next.b085 = true; next.b101 = false; next.b117 = true; next.b133 = true; next.b149 = false; break;
    case 6: next.b006 = false; next.b022 = true; next.b038 = true; next.b054 = false; next.b070 = true; next.b086 = true; next.b102 = false; next.b118 = true; next.b134 = true; next.b150 = false; break;
    case 7: next.b007 = false; next.b023 = true; next.b039 = true; next.b055 = false; next.b071 = true; next.b087 = true; next.b103 = false; next.b119 = true; next.b135 = true; next.b151 = false; break;
    case 8: next.b008 = false; next.b024 = true; next.b040 = true; next.b056 = false; next.b072 = true; next.b088 = true; next.b104 = false; next.b120 = true; next.b136 = true; next.b152 = false; break;
    case 9: next.b009 = false; next.b025 = true; next.b041 = true; next.b057 = false; next.b073 = true; next.b089 = true; next.b105 = false; next.b121 = true; next.b137 = true; next.b153 = false; break;
    case 10: next.b010 = false; next.b026 = true; next.b042 = true; next.b058 = false; next.b074 = true; next.b090 = true; next.b106 = false; next.b122 = true; next.b138 = true; next.b154 = false; break;
    case 11: next.b011 = false; next.b027 = true; next.b043 = true; next.b059 = false; next.b075 = true; next.b091 = true; next.b107 = false; next.b123 = true; next.b139 = true; next.b155 = false; break;
    case 12: next.b012 = false; next.b028 = true; next.b044 = true; next.b060 = false; next.b076 = true; next.b092 = true; next.b108 = false; next.b124 = true; next.b140 = true; next.b156 = false; break;
    case 13: next.b013 = false; next.b029 = true; next.b045 = true; next.b061 = false; next.b077 = true; next.b093 = true; next.b109 = false; next.b125 = true; next.b141 = true; next.b157 = false; break;
    case 14: next.b014 = false; next.b030 = true; next.b046 = true; next.b062 = false; next.b078 = true; next.b094 = true; next.b110 = false; next.b126 = true; next.b142 = true; next.b158 = false; break;
    case 15: next.b015 = false; next.b031 = true; next.b047 = true; next.b063 = false; next.b079 = true; next.b095 = true; next.b111 = false; next.b127 = true; next.b143 = true; next.b159 = false; break;
  }
  return next;
}
function readOften(o: Options, turns: number): number {
  let n = 0;
  for (let a = 0; a < turns; a++) for (let b = 0; b < turns; b++) for (let c = 0; c < turns; c++) { if (o.b000) n += 0; if (o.b001) n += 1; if (o.b002) n += 2; if (o.b003) n += 3; if (o.b004) n += 4; if (o.b005) n += 5; if (o.b006) n += 6; if (o.b007) n += 7; if (o.b008) n += 8; if (o.b009) n += 9; if (o.b010) n += 10; if (o.b011) n += 11; if (o.b012) n += 12; if (o.b013) n += 13; if (o.b014) n += 14; if (o.b015) n += 15; if (o.b016) n += 16; if (o.b017) n += 17; if (o.b018) n += 18; if (o.b019) n += 19; if (o.b020) n += 20; if (o.b021) n += 21; if (o.b022) n += 22; if (o.b023) n += 23; if (o.b024) n += 24; if (o.b025) n += 25; if (o.b026) n += 26; if (o.b027) n += 27; if (o.b028) n += 28; if (o.b029) n += 29; if (o.b030) n += 30; if (o.b031) n += 31; if (o.b032) n += 32; if (o.b033) n += 33; if (o.b034) n += 34; if (o.b035) n += 35; if (o.b036) n += 36; if (o.b037) n += 37; if (o.b038) n += 38; if (o.b039) n += 39; if (o.b040) n += 40; if (o.b041) n += 41; if (o.b042) n += 42; if (o.b043) n += 43; if (o.b044) n += 44; if (o.b045) n += 45; if (o.b046) n += 46; if (o.b047) n += 47; if (o.b048) n += 48; if (o.b049) n += 49; if (o.b050) n += 50; if (o.b051) n += 51; if (o.b052) n += 52; if (o.b053) n += 53; if (o.b054) n += 54; if (o.b055) n += 55; if (o.b056) n += 56; if (o.b057) n += 57; if (o.b058) n += 58; if (o.b059) n += 59; if (o.b060) n += 60; if (o.b061) n += 61; if (o.b062) n += 62; if (o.b063) n += 63; }
  return n;
}
function readOnce(o: Options): number {
  let n = 0;
  if (o.b064) n += 64; if (o.b065) n += 65; if (o.b066) n += 66; if (o.b067) n += 67; if (o.b068) n += 68; if (o.b069) n += 69; if (o.b070) n += 70; if (o.b071) n += 71; if (o.b072) n += 72; if (o.b073) n += 73; if (o.b074) n += 74; if (o.b075) n += 75; if (o.b076) n += 76; if (o.b077) n += 77; if (o.b078) n += 78; if (o.b079) n += 79; if (o.b080) n += 80; if (o.b081) n += 81; if (o.b082) n += 82; if (o.b083) n += 83; if (o.b084) n += 84; if (o.b085) n += 85; if (o.b086) n += 86; if (o.b087) n += 87; if (o.b088) n += 88; if (o.b089) n += 89; if (o.b090) n += 90; if (o.b091) n += 91; if (o.b092) n += 92; if (o.b093) n += 93; if (o.b094) n += 94; if (o.b095) n += 95; if (o.b096) n += 96; if (o.b097) n += 97; if (o.b098) n += 98; if (o.b099) n += 99; if (o.b100) n += 100; if (o.b101) n += 101; if (o.b102) n += 102; if (o.b103) n += 103; if (o.b104) n += 104; if (o.b105) n += 105; if (o.b106) n += 106; if (o.b107) n += 107; if (o.b108) n += 108; if (o.b109) n += 109; if (o.b110) n += 110; if (o.b111) n += 111; if (o.b112) n += 112; if (o.b113) n += 113; if (o.b114) n += 114; if (o.b115) n += 115; if (o.b116) n += 116; if (o.b117) n += 117; if (o.b118) n += 118; if (o.b119) n += 119; if (o.b120) n += 120; if (o.b121) n += 121; if (o.b122) n += 122; if (o.b123) n += 123; if (o.b124) n += 124; if (o.b125) n += 125; if (o.b126) n += 126; if (o.b127) n += 127; if (o.b128) n += 128; if (o.b129) n += 129; if (o.b130) n += 130; if (o.b131) n += 131; if (o.b132) n += 132; if (o.b133) n += 133; if (o.b134) n += 134; if (o.b135) n += 135; if (o.b136) n += 136; if (o.b137) n += 137; if (o.b138) n += 138; if (o.b139) n += 139; if (o.b140) n += 140; if (o.b141) n += 141; if (o.b142) n += 142; if (o.b143) n += 143; if (o.b144) n += 144; if (o.b145) n += 145; if (o.b146) n += 146; if (o.b147) n += 147; if (o.b148) n += 148; if (o.b149) n += 149; if (o.b150) n += 150; if (o.b151) n += 151; if (o.b152) n += 152; if (o.b153) n += 153; if (o.b154) n += 154; if (o.b155) n += 155; if (o.b156) n += 156; if (o.b157) n += 157; if (o.b158) n += 158; if (o.b159) n += 159;
  return n;
}
function label(n: number, depth: number): string { return depth > 0 ? label(n + 1, depth - 1) + "." : "t" + n; }
function readBesideTexts(o: Options, turns: number): number {
  let n = 0;
  for (let turn = 0; turn < turns; turn++) {
    n += label(turn, 3).length << 4;
    if (o.b100) n += 1;
    if (o.b116) n += 2;
    if (o.b132) n += 4;
    if (o.b148) n += 8;
  }
  return n;
}
let sum = 0;
for (let i = 0; i < 32; i++) sum += readOften(make(i), 3) + readOnce(make(i));
for (let i = 0; i < 64; i++) sum += readBesideTexts(make(4 + 16 * i), 8);
console.log(sum);
