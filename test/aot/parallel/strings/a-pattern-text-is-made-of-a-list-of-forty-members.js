// A list that the program writes out with more than 32 members, not all of them plain constants, is not made in one operation with its members as operands: it is made empty, filled member by
// member and cut to its length. These are the list's own making, not writes that nobody follows: the build knows what such a list holds as it knows it of a short one, be its members texts or the
// rows of a table.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
const STEM = "[a-z]";
const words = [
  "w00[a-z]", "w01[a-z]", "w02[a-z]", `w03${STEM}`, "w04[a-z]", "w05[a-z]", "w06[a-z]", "w07[a-z]", "w08[a-z]", "w09[a-z]", `w10${STEM}`, "w11[a-z]", "w12[a-z]", "w13[a-z]", "w14[a-z]", "w15[a-z]", "w16[a-z]", `w17${STEM}`, "w18[a-z]", "w19[a-z]", "w20[a-z]", "w21[a-z]", "w22[a-z]", "w23[a-z]", `w24${STEM}`, "w25[a-z]", "w26[a-z]", "w27[a-z]", "w28[a-z]", "w29[a-z]", "w30[a-z]", `w31${STEM}`, "w32[a-z]", "w33[a-z]", "w34[a-z]", "w35[a-z]", "w36[a-z]", "w37[a-z]", `w38${STEM}`, "w39[a-z]",
];
const table = [
  { source: "r00+", flags: "gi", open: "<0" },
  { source: "r01+", flags: "g", open: "<1" },
  { source: `r02${STEM}`, flags: undefined, open: "<2" },
  { source: "r03+", flags: "gi", open: "<3" },
  { source: "r04+", flags: "g", open: "<4" },
  { source: "r05+", flags: undefined, open: "<5" },
  { source: "r06+", flags: "gi", open: "<6" },
  { source: `r07${STEM}`, flags: "g", open: "<7" },
  { source: "r08+", flags: undefined, open: "<8" },
  { source: "r09+", flags: "gi", open: "<9" },
  { source: "r10+", flags: "g", open: "<10" },
  { source: "r11+", flags: undefined, open: "<11" },
  { source: `r12${STEM}`, flags: "gi", open: "<12" },
  { source: "r13+", flags: "g", open: "<13" },
  { source: "r14+", flags: undefined, open: "<14" },
  { source: "r15+", flags: "gi", open: "<15" },
  { source: "r16+", flags: "g", open: "<16" },
  { source: `r17${STEM}`, flags: undefined, open: "<17" },
  { source: "r18+", flags: "gi", open: "<18" },
  { source: "r19+", flags: "g", open: "<19" },
  { source: "r20+", flags: undefined, open: "<20" },
  { source: "r21+", flags: "gi", open: "<21" },
  { source: `r22${STEM}`, flags: "g", open: "<22" },
  { source: "r23+", flags: undefined, open: "<23" },
  { source: "r24+", flags: "gi", open: "<24" },
  { source: "r25+", flags: "g", open: "<25" },
  { source: "r26+", flags: undefined, open: "<26" },
  { source: `r27${STEM}`, flags: "gi", open: "<27" },
  { source: "r28+", flags: "g", open: "<28" },
  { source: "r29+", flags: undefined, open: "<29" },
  { source: "r30+", flags: "gi", open: "<30" },
  { source: "r31+", flags: "g", open: "<31" },
  { source: `r32${STEM}`, flags: undefined, open: "<32" },
  { source: "r33+", flags: "gi", open: "<33" },
  { source: "r34+", flags: "g", open: "<34" },
  { source: "r35+", flags: undefined, open: "<35" },
  { source: "r36+", flags: "gi", open: "<36" },
  { source: `r37${STEM}`, flags: "g", open: "<37" },
  { source: "r38+", flags: undefined, open: "<38" },
  { source: "r39+", flags: "gi", open: "<39" },
];
function compile(isGlobal) {
  return table.map(row => new RegExp(`^${row.open}${row.source}`, isGlobal ? (row.flags ?? "").replace("g", "") + "g" : (row.flags ?? "")));
}
const made = [new RegExp("^(?:" + words.slice(0, 3).join("|") + ")$"), new RegExp(words.slice(35).join("|")), ...compile(true)];
console.log(made.length, made[0].source, made[1].source, made[2].source, made[41].source + "/" + made[41].flags);
let hits = 0;
for (const each of made) {
  each.lastIndex = 0;
  if (each.test("w01x") || each.test("<39r39")) hits++;
}
console.log(hits);
