"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var space = {};
__export(space, { n0: () => n0, n1: () => n1, n2: () => n2, n3: () => n3, n4: () => n4, n5: () => n5, n6: () => n6, n7: () => n7, n8: () => n8, n9: () => n9, n10: () => n10, n11: () => n11, n12: () => n12, n13: () => n13, n14: () => n14, n15: () => n15, n16: () => n16, n17: () => n17, n18: () => n18, n19: () => n19, n20: () => n20, n21: () => n21, n22: () => n22, n23: () => n23, n24: () => n24, n25: () => n25, n26: () => n26, n27: () => n27, n28: () => n28, n29: () => n29, n30: () => n30, n31: () => n31, n32: () => n32, n33: () => n33, n34: () => n34, n35: () => n35, n36: () => n36, n37: () => n37, n38: () => n38, n39: () => n39, n40: () => n40, n41: () => n41, n42: () => n42, n43: () => n43, n44: () => n44, n45: () => n45, n46: () => n46, n47: () => n47 });
function n0(a) { return a + 0 | 0; }
function n1(a) { return a + 1 | 0; }
function n2(a) { return a + 2 | 0; }
function n3(a) { return a + 3 | 0; }
function n4(a) { return a + 4 | 0; }
function n5(a) { return a + 5 | 0; }
function n6(a) { return a + 6 | 0; }
function n7(a) { return a + 7 | 0; }
function n8(a) { return a + 8 | 0; }
function n9(a) { return a + 9 | 0; }
function n10(a) { return a + 10 | 0; }
function n11(a) { return a + 11 | 0; }
function n12(a) { return a + 12 | 0; }
function n13(a) { return a + 13 | 0; }
function n14(a) { return a + 14 | 0; }
function n15(a) { return a + 15 | 0; }
function n16(a) { return a + 16 | 0; }
function n17(a) { return a + 17 | 0; }
function n18(a) { return a + 18 | 0; }
function n19(a) { return a + 19 | 0; }
function n20(a) { return a + 20 | 0; }
function n21(a) { return a + 21 | 0; }
function n22(a) { return a + 22 | 0; }
function n23(a) { return a + 23 | 0; }
function n24(a) { return a + 24 | 0; }
function n25(a) { return a + 25 | 0; }
function n26(a) { return a + 26 | 0; }
function n27(a) { return a + 27 | 0; }
function n28(a) { return a + 28 | 0; }
function n29(a) { return a + 29 | 0; }
function n30(a) { return a + 30 | 0; }
function n31(a) { return a + 31 | 0; }
function n32(a) { return a + 32 | 0; }
function n33(a) { return a + 33 | 0; }
function n34(a) { return a + 34 | 0; }
function n35(a) { return a + 35 | 0; }
function n36(a) { return a + 36 | 0; }
function n37(a) { return a + 37 | 0; }
function n38(a) { return a + 38 | 0; }
function n39(a) { return a + 39 | 0; }
function n40(a) { return a + 40 | 0; }
function n41(a) { return a + 41 | 0; }
function n42(a) { return a + 42 | 0; }
function n43(a) { return a + 43 | 0; }
function n44(a) { return a + 44 | 0; }
function n45(a) { return a + 45 | 0; }
function n46(a) { return a + 46 | 0; }
function n47(a) { return a + 47 | 0; }
const hidden = Object[JSON.parse("\"defineProperty\"")];
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum = sum + space.n0(turn) + space.n7(turn) + space.n23(turn) + space.n47(turn) | 0; return sum; }
said.push(run(JSON.parse("50")));
for (let more = 0; more < 200; more++) hidden(space, "late" + more, { get: () => more, enumerable: true, configurable: true });
if (typeof Bun !== "undefined") Bun.gc(true);
said.push(run(JSON.parse("50")), space.late199);
for (let more = 0; more < 200; more += 2) delete space["late" + more];
delete space.n23;
hidden(space, "n23", { get: () => n0, enumerable: true, configurable: true });
if (typeof Bun !== "undefined") Bun.gc(true);
said.push(run(JSON.parse("50")), Object.keys(space).length);
console.log(said.join());
