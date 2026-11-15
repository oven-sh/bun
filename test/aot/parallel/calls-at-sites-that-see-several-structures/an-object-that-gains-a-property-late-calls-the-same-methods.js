"use strict";
const hide = value => [value][JSON.parse("0")];
const late = JSON.parse('"gainedLate"');
var Reader = function Reader(seed) { this.seed = seed; this.sum = 0; };
var onReader = Reader.prototype;
onReader.step0 = function () { this.sum = (this.sum * 3 + this.seed + 100) % 65521; };
onReader.step1 = function () { this.sum = (this.sum * 3 + this.seed + 101) % 65521; };
onReader.step2 = function () { this.sum = (this.sum * 3 + this.seed + 102) % 65521; };
onReader.step3 = function () { this.sum = (this.sum * 3 + this.seed + 103) % 65521; };
onReader.step4 = function () { this.sum = (this.sum * 3 + this.seed + 104) % 65521; };
onReader.step5 = function () { this.sum = (this.sum * 3 + this.seed + 105) % 65521; };
onReader.step6 = function () { this.sum = (this.sum * 3 + this.seed + 106) % 65521; };
onReader.step7 = function () { this.sum = (this.sum * 3 + this.seed + 107) % 65521; };
onReader.step8 = function () { this.sum = (this.sum * 3 + this.seed + 108) % 65521; };
onReader.step9 = function () { this.sum = (this.sum * 3 + this.seed + 109) % 65521; };
onReader.step10 = function () { this.sum = (this.sum * 3 + this.seed + 110) % 65521; };
onReader.step11 = function () { this.sum = (this.sum * 3 + this.seed + 111) % 65521; };
onReader.step12 = function () { this.sum = (this.sum * 3 + this.seed + 112) % 65521; };
onReader.step13 = function () { this.sum = (this.sum * 3 + this.seed + 113) % 65521; };
onReader.step14 = function () { this.sum = (this.sum * 3 + this.seed + 114) % 65521; };
onReader.step15 = function () { this.sum = (this.sum * 3 + this.seed + 115) % 65521; };
onReader.step16 = function () { this.sum = (this.sum * 3 + this.seed + 116) % 65521; };
onReader.step17 = function () { this.sum = (this.sum * 3 + this.seed + 117) % 65521; };
onReader.step18 = function () { this.sum = (this.sum * 3 + this.seed + 118) % 65521; };
onReader.step19 = function () { this.sum = (this.sum * 3 + this.seed + 119) % 65521; };
onReader.step20 = function () { this.sum = (this.sum * 3 + this.seed + 120) % 65521; };
onReader.step21 = function () { this.sum = (this.sum * 3 + this.seed + 121) % 65521; };
onReader.step22 = function () { this.sum = (this.sum * 3 + this.seed + 122) % 65521; };
onReader.step23 = function () { this.sum = (this.sum * 3 + this.seed + 123) % 65521; };
function walk(one) { one.step0(); one.step1(); one.step2(); one.step3(); one.step4(); one.step5(); one.step6(); one.step7(); one.step8(); one.step9(); one.step10(); one.step11(); one.step12(); one.step13(); one.step14(); one.step15(); one.step16(); one.step17(); one.step18(); one.step19(); one.step20(); one.step21(); one.step22(); one.step23(); return one.sum; }
let all = 7;
for (let turn = 0; turn < 30000; turn++) {
  const one = new (hide(Reader))(turn & 15);
  all = (all * 31 + hide(walk)(hide(one))) % 1000003;
  one[late] = turn;
  all = (all * 31 + hide(walk)(hide(one))) % 1000003;
}
console.log(all);
