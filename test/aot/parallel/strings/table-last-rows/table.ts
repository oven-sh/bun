type Row = { name: string; source: string; flags?: string; mark?: string; kind: number }
type Out = { name: string; kind: number; whole?: RegExp; first?: RegExp }
const OUTER = "[ \\t]*"
function anchored(source: string): string {
  return "^(?:" + source + ")"
}
const A0 = "[a-z]"
const A1 = `${A0}+`
const A2 = `(?:${A1}\\.${A0})?`
const A3 = `(?:${A2}\\.${A1})?`
const A4 = `(?:${A3}\\.${A2})?`
const A5 = `(?:${A4}\\.${A3})?`
const A6 = `(?:${A5}\\.${A4})?`
const A7 = `(?:${A6}\\.${A5})?`
const A8 = `(?:${A7}\\.${A6})?`
const A9 = `(?:${A8}\\.${A7})?`
const A10 = `(?:${A9}\\.${A8})?`
const A11 = `(?:${A10}\\.${A9})?`
const A12 = `(?:${A11}\\.${A10})?`
const A13 = `(?:${A12}\\.${A11})?`
const TABLE: Row[] = [
  { name: "n0", source: "s0[a-z]+(?:x|y)", kind: 0 },
  { name: "n1", source: "s1[a-z]+(?:x|y)", mark: "<", kind: 1 },
  { name: "n2", source: `^${A9}x2${A8}$`, kind: 2 },
  { name: "n3", source: "s3[a-z]+(?:x|y)", kind: 3 },
  { name: "n4", source: "s4[a-z]+(?:x|y)", kind: 4 },
  { name: "n5", source: A11, kind: 5 },
  { name: "n6", source: `^${A10}x6${A9}$`, kind: 6 },
  { name: "n7", source: "s7[a-z]+(?:x|y)", flags: "i", kind: 7 },
  { name: "n8", source: "s8[a-z]+(?:x|y)", kind: 8 },
  { name: "n9", source: "s9[a-z]+(?:x|y)", kind: 9 },
  { name: "n10", source: `^${A11}x10${A10}$`, kind: 10 },
  { name: "n11", source: "s11[a-z]+(?:x|y)", kind: 11 },
  { name: "n12", source: "s12[a-z]+(?:x|y)", kind: 12 },
  { name: "n13", source: "s13[a-z]+(?:x|y)", kind: 13 },
  { name: "n14", source: `^${A12}x14${A11}$`, kind: 14 },
  { name: "n15", source: "s15[a-z]+(?:x|y)", kind: 15 },
  { name: "n16", source: "s16[a-z]+(?:x|y)", kind: 16 },
  { name: "n17", source: A11, kind: 17 },
  { name: "n18", source: `^${A13}x18${A12}$`, kind: 18 },
  { name: "n19", source: "s19[a-z]+(?:x|y)", flags: "i", kind: 19 },
  { name: "n20", source: "s20[a-z]+(?:x|y)", kind: 20 },
  { name: "n21", source: "s21[a-z]+(?:x|y)", kind: 21 },
  { name: "n22", source: `^${A9}x22${A8}$`, kind: 22 },
  { name: "n23", source: "s23[a-z]+(?:x|y)", kind: 23 },
  { name: "n24", source: "s24[a-z]+(?:x|y)", kind: 24 },
  { name: "n25", source: "s25[a-z]+(?:x|y)", kind: 25 },
  { name: "n26", source: `^${A10}x26${A9}$`, kind: 26 },
  { name: "n27", source: "s27[a-z]+(?:x|y)", kind: 27 },
  { name: "n28", source: "s28[a-z]+(?:x|y)", kind: 28 },
  { name: "n29", source: A11, kind: 29 },
  { name: "n30", source: `^${A11}x30${A10}$`, kind: 30 },
  { name: "n31", source: "s31[a-z]+(?:x|y)", flags: "i", kind: 31 },
  { name: "n32", source: "s32[a-z]+(?:x|y)", kind: 32 },
  { name: "n33", source: "s33[a-z]+(?:x|y)", kind: 33 },
  { name: "n34", source: `^${A12}x34${A11}$`, kind: 34 },
  { name: "n35", source: "s35[a-z]+(?:x|y)", kind: 35 },
  { name: "n36", source: "s36[a-z]+(?:x|y)", kind: 36 },
  { name: "n37", source: "s37[a-z]+(?:x|y)", kind: 37 },
  { name: "n38", source: `^${A13}x38${A12}$`, kind: 38 },
  { name: "n39", source: "s39[a-z]+(?:x|y)", kind: 39 },
  { name: "n40", source: "s40[a-z]+(?:x|y)", kind: 40 },
  { name: "n41", source: A11, kind: 41 },
  { name: "n42", source: `^${A9}x42${A8}$`, kind: 42 },
  { name: "n43", source: "s43[a-z]+(?:x|y)", kind: 43 },
  { name: "n44", source: "s44[a-z]+(?:x|y)", kind: 44 },
  { name: "n45", source: "s45[a-z]+(?:x|y)", kind: 45 },
  { name: "n46", source: `^${A10}x46${A9}$`, kind: 46 },
  { name: "n47", source: "s47[a-z]+(?:x|y)", kind: 47 },
  { name: "n48", source: "s48[a-z]+(?:x|y)", kind: 48 },
  { name: "n49", source: "s49[a-z]+(?:x|y)", kind: 49 },
  { name: "n50", source: `^${A11}x50${A10}$`, kind: 50 },
  { name: "n51", source: "s51[a-z]+(?:x|y)", kind: 51 },
  { name: "n52", source: "s52[a-z]+(?:x|y)", kind: 52 },
  { name: "n53", source: "s53[a-z]+(?:x|y)", kind: 53 },
  { name: "n54", source: `^${A12}x54${A11}$`, kind: 54 },
  { name: "n55", source: "s55[a-z]+(?:x|y)", kind: 55 },
  { name: "n56", source: "s56[a-z]+(?:x|y)", kind: 56 },
  { name: "n57", source: "s57[a-z]+(?:x|y)", kind: 57 },
  { name: "n58", source: "s58[a-z]+(?:x|y)", kind: 58 },
  { name: "n59", source: "s59[a-z]+(?:x|y)", kind: 59 },
  { name: "n60", source: "s60[a-z]+(?:x|y)", kind: 60 },
  { name: "n61", source: "s61[a-z]+(?:x|y)", kind: 61 },
  { name: "n62", source: "s62[a-z]+(?:x|y)", kind: 62 },
  { name: "n63", source: "s63[a-z]+(?:x|y)", kind: 63 },
]
export function compile(global: boolean): Out[] {
  return TABLE.map(row => {
    const flags = (row.flags ?? "").replace("g", "")
    const base = { name: row.name, kind: row.kind }
    if (row.mark === undefined) {
      return { ...base, whole: new RegExp(row.source, global ? flags + "g" : (row.flags ?? "")) }
    }
    return {
      ...base,
      first: new RegExp(anchored(row.source), flags),
      whole: new RegExp(`^${row.mark}x${row.mark}y${OUTER}z${row.mark}w${row.source}`, global ? flags + "g" : flags),
    }
  })
}
