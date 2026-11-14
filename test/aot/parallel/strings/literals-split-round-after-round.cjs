// More literals than the split cache has slots, split again and again: the pieces are names of properties, and what a caller changes in one array is in no other.
const routes = [];
for (const text of [
  "KMLI OBK J547 PMM KBTL", "KGRB OKK V305 WELDO KIND", "KANE KANAC V97 ODI V129 GROWL KSPI", "KLIT MCI J41 OVR KSUX", "length constructor __proto__ 0 17", "", " ", "a", "a ", " a", "é ÿ Ā", "LEFT|+1 210@10KTS  x",
  "A0 B0 C0", "A1 B1 C1", "A2 B2 C2", "A3 B3 C3", "A4 B4 C4", "A5 B5 C5", "A6 B6 C6", "A7 B7 C7", "A8 B8 C8", "A9 B9 C9", "AA BA CA", "AB BB CB", "AC BC CC", "AD BD CD", "AE BE CE", "AF BF CF",
  "D0 E0 F0", "D1 E1 F1", "D2 E2 F2", "D3 E3 F3", "D4 E4 F4", "D5 E5 F5", "D6 E6 F6", "D7 E7 F7", "D8 E8 F8", "D9 E9 F9", "DA EA FA", "DB EB FB", "DC EC FC", "DD ED FD", "DE EE FE", "DF EF FF",
  "G0,H0,I0", "G1,H1,I1", "G2,H2,I2", "G3,H3,I3", "G4,H4,I4", "G5,H5,I5", "G6,H6,I6", "G7,H7,I7", "G8,H8,I8", "G9,H9,I9", "GA,HA,IA", "GB,HB,IB", "GC,HC,IC", "GD,HD,ID", "GE,HE,IE", "GF,HF,IF",
  "J0 K0 L0", "J1 K1 L1", "J2 K2 L2", "J3 K3 L3", "J4 K4 L4", "J5 K5 L5", "J6 K6 L6", "J7 K7 L7", "J8 K8 L8", "J9 K9 L9", "JA KA LA", "JB KB LB", "JC KC LC", "JD KD LD", "JE KE LE", "JF KF LF",
]) routes.push(text);
const places = { KMLI: 1, OBK: 2, KIND: 3, A0: 4, B7: 5, LF: 6, H3: 7, "0": 8, "17": 9, "": 10, "é": 11, Ā: 12, "LEFT|+1": 13 };
const spaces = / +/, groups = /(,)|( )/;
function look(pieces) {
  let found = "";
  for (const piece of pieces) found += piece === undefined ? "u" : typeof places[piece] === "number" ? places[piece] : piece in places ? "i" : "-";
  return found;
}
for (let round = 0; round < 4; round++) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < routes.length; i++) {
    const bySpaces = routes[i].split(spaces);
    const statics = RegExp.lastMatch.length + ":" + RegExp.leftContext.length;
    const byGroups = routes[i].split(groups), byText = routes[i].split(" "), byComma = routes[i].split(","), letters = routes[i].split("");
    const line = [bySpaces.length, look(bySpaces), statics, byGroups.length, look(byGroups), byText.length, look(byText), byComma.length, letters.length].join(" ");
    for (let k = 0; k < line.length; k++) sum = (sum * 31 + line.charCodeAt(k)) | 0;
    if (i < 12) out.push(line);
    bySpaces.push("pushed");
    byGroups[0] = "changed";
    byText.reverse();
    byComma.length = 0;
    letters.sort();
    if (round === 1 && i % 9 === 0) routes[i].split(spaces, 1).push("limited");
  }
  console.log(round, sum, out.join(" | "));
  if (round === 2) Bun.gc(true);
}
