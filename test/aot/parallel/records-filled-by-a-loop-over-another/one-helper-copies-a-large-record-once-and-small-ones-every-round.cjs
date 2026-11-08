// STATISTIC: FlowAppendedFields >= 62
// STATISTIC: FieldsOutOfLine >= 60
"use strict";
const rounds = 3000;
const large = { n0: 0, n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6, n7: 7, n8: 8, n9: 9, n10: 10, n11: 11, n12: 12, n13: 13, n14: 14, n15: 15, n16: 16, n17: 17, n18: 18, n19: 19, n20: 20, n21: 21, n22: 22, n23: 23, n24: 24, n25: 25, n26: 26, n27: 27, n28: 28, n29: 29, n30: 30, n31: 31, n32: 32, n33: 33, n34: 34, n35: 35, n36: 36, n37: 37, n38: 38, n39: 39, n40: 40, n41: 41, n42: 42, n43: 43, n44: 44, n45: 45, n46: 46, n47: 47, n48: 48, n49: 49, n50: 50, n51: 51, n52: 52, n53: 53, n54: 54, n55: 55, n56: 56, n57: 57, n58: 58, n59: 59 };
const small = at => ({ a: at, b: at + 1 });
function extend(to, from) { for (const name in from) to[name] = from[name]; return to; }
const whole = extend({}, large);
const kept = [];
for (let at = 0; at < rounds; at++) kept.push(extend({}, small(at)));
let sum = 0;
for (let at = 0; at < kept.length; at++) sum = (sum + kept[at].a + kept[at].b) % 1000003;
let names = "";
for (const name in kept[rounds - 1]) names += name + ",";
console.log(sum, whole.n59, whole.n0, names, "n5" in kept[0], kept[0].n5, whole.a);
