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
var Keeper = function Keeper(seed) { this.seed = seed; this.sum = 0; };
var onKeeper = Keeper.prototype;
onKeeper.step0 = function () { this.sum = (this.sum * 3 + this.seed + 900) % 65521; };
onKeeper.step1 = function () { this.sum = (this.sum * 3 + this.seed + 901) % 65521; };
onKeeper.step2 = function () { this.sum = (this.sum * 3 + this.seed + 902) % 65521; };
onKeeper.step3 = function () { this.sum = (this.sum * 3 + this.seed + 903) % 65521; };
onKeeper.step4 = function () { this.sum = (this.sum * 3 + this.seed + 904) % 65521; };
onKeeper.step5 = function () { this.sum = (this.sum * 3 + this.seed + 905) % 65521; };
onKeeper.step6 = function () { this.sum = (this.sum * 3 + this.seed + 906) % 65521; };
onKeeper.step7 = function () { this.sum = (this.sum * 3 + this.seed + 907) % 65521; };
onKeeper.step8 = function () { this.sum = (this.sum * 3 + this.seed + 908) % 65521; };
onKeeper.step9 = function () { this.sum = (this.sum * 3 + this.seed + 909) % 65521; };
onKeeper.step10 = function () { this.sum = (this.sum * 3 + this.seed + 910) % 65521; };
onKeeper.step11 = function () { this.sum = (this.sum * 3 + this.seed + 911) % 65521; };
onKeeper.step12 = function () { this.sum = (this.sum * 3 + this.seed + 912) % 65521; };
onKeeper.step13 = function () { this.sum = (this.sum * 3 + this.seed + 913) % 65521; };
onKeeper.step14 = function () { this.sum = (this.sum * 3 + this.seed + 914) % 65521; };
onKeeper.step15 = function () { this.sum = (this.sum * 3 + this.seed + 915) % 65521; };
onKeeper.step16 = function () { this.sum = (this.sum * 3 + this.seed + 916) % 65521; };
onKeeper.step17 = function () { this.sum = (this.sum * 3 + this.seed + 917) % 65521; };
onKeeper.step18 = function () { this.sum = (this.sum * 3 + this.seed + 918) % 65521; };
onKeeper.step19 = function () { this.sum = (this.sum * 3 + this.seed + 919) % 65521; };
onKeeper.step20 = function () { this.sum = (this.sum * 3 + this.seed + 920) % 65521; };
onKeeper.step21 = function () { this.sum = (this.sum * 3 + this.seed + 921) % 65521; };
onKeeper.step22 = function () { this.sum = (this.sum * 3 + this.seed + 922) % 65521; };
onKeeper.step23 = function () { this.sum = (this.sum * 3 + this.seed + 923) % 65521; };
function walk(one) { one.step0(); one.step1(); one.step2(); one.step3(); one.step4(); one.step5(); one.step6(); one.step7(); one.step8(); one.step9(); one.step10(); one.step11(); one.step12(); one.step13(); one.step14(); one.step15(); one.step16(); one.step17(); one.step18(); one.step19(); one.step20(); one.step21(); one.step22(); one.step23(); return one.sum; }
const kinds = [Reader, Writer, Keeper];
const stepOfItsOwn = function () { this.sum = (this.sum * 5 + this.seed + 7) % 65521; };
const namesOfSteps = JSON.parse(JSON.stringify(Object.keys(Reader.prototype)));
function makeWithStepsOfItsOwn(seed) { const one = { seed, sum: 0 }; for (const name of namesOfSteps) one[name] = stepOfItsOwn; return one; }
function make(kind, gains, seed) { const one = kind === 3 ? makeWithStepsOfItsOwn(seed) : new (hide(kinds[kind]))(seed); if (gains) one[late] = seed; return one; }
const stretches = [[0, 0, 0, 1], [3, 0, 3, 0], [0, 0, 0, 0], [0, 1, 1, 0], [1, 0, 1, 1], [3, 1, 3, 1], [1, 1, 1, 1], [1, 1, 0, 0], [2, 0, 0, 1], [0, 0, 2, 1], [2, 1, 2, 0], [3, 0, 2, 1], [0, 1, 0, 0]];
let all = 7;
for (let round = 0; round < 6; round++) {
  for (const [firstKind, firstGains, secondKind, secondGains] of stretches) {
    for (let turn = 0; turn < 1500; turn++) {
      all = (all * 31 + hide(walk)(make(firstKind, firstGains, turn & 7))) % 1000003;
      all = (all * 31 + hide(walk)(make(secondKind, secondGains, turn & 3))) % 1000003;
      if (turn % 500 === 499) all = (all * 31 + hide(walk)(make((firstKind + 1) % 4, turn & 1, 5))) % 1000003;
    }
  }
}
console.log(all);
