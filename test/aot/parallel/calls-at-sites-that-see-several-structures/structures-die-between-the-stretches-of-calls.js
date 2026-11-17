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
var Writer = function Writer(seed) { this.seed = seed; this.sum = 0; };
var onWriter = Writer.prototype;
onWriter.step0 = function () { this.sum = (this.sum * 3 + this.seed + 500) % 65521; };
onWriter.step1 = function () { this.sum = (this.sum * 3 + this.seed + 501) % 65521; };
onWriter.step2 = function () { this.sum = (this.sum * 3 + this.seed + 502) % 65521; };
onWriter.step3 = function () { this.sum = (this.sum * 3 + this.seed + 503) % 65521; };
onWriter.step4 = function () { this.sum = (this.sum * 3 + this.seed + 504) % 65521; };
onWriter.step5 = function () { this.sum = (this.sum * 3 + this.seed + 505) % 65521; };
onWriter.step6 = function () { this.sum = (this.sum * 3 + this.seed + 506) % 65521; };
onWriter.step7 = function () { this.sum = (this.sum * 3 + this.seed + 507) % 65521; };
onWriter.step8 = function () { this.sum = (this.sum * 3 + this.seed + 508) % 65521; };
onWriter.step9 = function () { this.sum = (this.sum * 3 + this.seed + 509) % 65521; };
onWriter.step10 = function () { this.sum = (this.sum * 3 + this.seed + 510) % 65521; };
onWriter.step11 = function () { this.sum = (this.sum * 3 + this.seed + 511) % 65521; };
onWriter.step12 = function () { this.sum = (this.sum * 3 + this.seed + 512) % 65521; };
onWriter.step13 = function () { this.sum = (this.sum * 3 + this.seed + 513) % 65521; };
onWriter.step14 = function () { this.sum = (this.sum * 3 + this.seed + 514) % 65521; };
onWriter.step15 = function () { this.sum = (this.sum * 3 + this.seed + 515) % 65521; };
onWriter.step16 = function () { this.sum = (this.sum * 3 + this.seed + 516) % 65521; };
onWriter.step17 = function () { this.sum = (this.sum * 3 + this.seed + 517) % 65521; };
onWriter.step18 = function () { this.sum = (this.sum * 3 + this.seed + 518) % 65521; };
onWriter.step19 = function () { this.sum = (this.sum * 3 + this.seed + 519) % 65521; };
onWriter.step20 = function () { this.sum = (this.sum * 3 + this.seed + 520) % 65521; };
onWriter.step21 = function () { this.sum = (this.sum * 3 + this.seed + 521) % 65521; };
onWriter.step22 = function () { this.sum = (this.sum * 3 + this.seed + 522) % 65521; };
onWriter.step23 = function () { this.sum = (this.sum * 3 + this.seed + 523) % 65521; };
function walk(one) { one.step0(); one.step1(); one.step2(); one.step3(); one.step4(); one.step5(); one.step6(); one.step7(); one.step8(); one.step9(); one.step10(); one.step11(); one.step12(); one.step13(); one.step14(); one.step15(); one.step16(); one.step17(); one.step18(); one.step19(); one.step20(); one.step21(); one.step22(); one.step23(); return one.sum; }
const names = JSON.parse('["gainedLate", "gainedLater", "gainedLast"]');
let all = 7;
function stretch(Kind, name, both) {
  for (let turn = 0; turn < 2500; turn++) {
    const one = new (hide(Kind))(turn & 15);
    if (both || !name) all = (all * 31 + hide(walk)(hide(one))) % 1000003;
    if (name) { one[name] = turn; all = (all * 31 + hide(walk)(hide(one))) % 1000003; }
  }
}
for (let round = 0; round < 4; round++) {
  for (const name of names) {
    stretch(Reader, name, true);
    Bun.gc(true);
    stretch(Reader, null, false);
    Bun.gc(true);
    stretch(Reader, name, false);
    Bun.gc(true);
    stretch(Writer, name, true);
    Bun.gc(true);
    stretch(Reader, names[(round + 1) % 3], true);
  }
}
console.log(all);
