// Twelve constructor functions wait for their set-up: a loop over objects of each is entered over no turns in each of sixty rounds in front of it, and in each round another function, which none of them waits for, is named for the first time. The operation that begins the guards is not called again for that; behind the set-up the loops make no object.
// COUNT: operation:operationAOTBeginMemberGuards <= 40
// COUNT: operation:operationAOTAllocateSlow <= 50
"use strict";
const none = JSON.parse("0");
function turn0(i) { return new Made0(i & 7).area(); }
function run0(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn0(i)) | 0; return sum; }
function install0() { Made0.prototype.area = function () { return this.a + 0; }; }
function Made0(a) { this.a = a; }
function turn1(i) { return new Made1(i & 7).area(); }
function run1(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn1(i)) | 0; return sum; }
function install1() { Made1.prototype.area = function () { return this.a + 1; }; }
function Made1(a) { this.a = a; }
function turn2(i) { return new Made2(i & 7).area(); }
function run2(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn2(i)) | 0; return sum; }
function install2() { Made2.prototype.area = function () { return this.a + 2; }; }
function Made2(a) { this.a = a; }
function turn3(i) { return new Made3(i & 7).area(); }
function run3(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn3(i)) | 0; return sum; }
function install3() { Made3.prototype.area = function () { return this.a + 3; }; }
function Made3(a) { this.a = a; }
function turn4(i) { return new Made4(i & 7).area(); }
function run4(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn4(i)) | 0; return sum; }
function install4() { Made4.prototype.area = function () { return this.a + 4; }; }
function Made4(a) { this.a = a; }
function turn5(i) { return new Made5(i & 7).area(); }
function run5(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn5(i)) | 0; return sum; }
function install5() { Made5.prototype.area = function () { return this.a + 5; }; }
function Made5(a) { this.a = a; }
function turn6(i) { return new Made6(i & 7).area(); }
function run6(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn6(i)) | 0; return sum; }
function install6() { Made6.prototype.area = function () { return this.a + 6; }; }
function Made6(a) { this.a = a; }
function turn7(i) { return new Made7(i & 7).area(); }
function run7(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn7(i)) | 0; return sum; }
function install7() { Made7.prototype.area = function () { return this.a + 7; }; }
function Made7(a) { this.a = a; }
function turn8(i) { return new Made8(i & 7).area(); }
function run8(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn8(i)) | 0; return sum; }
function install8() { Made8.prototype.area = function () { return this.a + 8; }; }
function Made8(a) { this.a = a; }
function turn9(i) { return new Made9(i & 7).area(); }
function run9(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn9(i)) | 0; return sum; }
function install9() { Made9.prototype.area = function () { return this.a + 9; }; }
function Made9(a) { this.a = a; }
function turn10(i) { return new Made10(i & 7).area(); }
function run10(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn10(i)) | 0; return sum; }
function install10() { Made10.prototype.area = function () { return this.a + 10; }; }
function Made10(a) { this.a = a; }
function turn11(i) { return new Made11(i & 7).area(); }
function run11(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn11(i)) | 0; return sum; }
function install11() { Made11.prototype.area = function () { return this.a + 11; }; }
function Made11(a) { this.a = a; }
function* other0() { yield 0; }
function name0() { return other0; }
function* other1() { yield 1; }
function name1() { return other1; }
function* other2() { yield 2; }
function name2() { return other2; }
function* other3() { yield 3; }
function name3() { return other3; }
function* other4() { yield 4; }
function name4() { return other4; }
function* other5() { yield 5; }
function name5() { return other5; }
function* other6() { yield 6; }
function name6() { return other6; }
function* other7() { yield 7; }
function name7() { return other7; }
function* other8() { yield 8; }
function name8() { return other8; }
function* other9() { yield 9; }
function name9() { return other9; }
function* other10() { yield 10; }
function name10() { return other10; }
function* other11() { yield 11; }
function name11() { return other11; }
function* other12() { yield 12; }
function name12() { return other12; }
function* other13() { yield 13; }
function name13() { return other13; }
function* other14() { yield 14; }
function name14() { return other14; }
function* other15() { yield 15; }
function name15() { return other15; }
function* other16() { yield 16; }
function name16() { return other16; }
function* other17() { yield 17; }
function name17() { return other17; }
function* other18() { yield 18; }
function name18() { return other18; }
function* other19() { yield 19; }
function name19() { return other19; }
function* other20() { yield 20; }
function name20() { return other20; }
function* other21() { yield 21; }
function name21() { return other21; }
function* other22() { yield 22; }
function name22() { return other22; }
function* other23() { yield 23; }
function name23() { return other23; }
function* other24() { yield 24; }
function name24() { return other24; }
function* other25() { yield 25; }
function name25() { return other25; }
function* other26() { yield 26; }
function name26() { return other26; }
function* other27() { yield 27; }
function name27() { return other27; }
function* other28() { yield 28; }
function name28() { return other28; }
function* other29() { yield 29; }
function name29() { return other29; }
function* other30() { yield 30; }
function name30() { return other30; }
function* other31() { yield 31; }
function name31() { return other31; }
function* other32() { yield 32; }
function name32() { return other32; }
function* other33() { yield 33; }
function name33() { return other33; }
function* other34() { yield 34; }
function name34() { return other34; }
function* other35() { yield 35; }
function name35() { return other35; }
function* other36() { yield 36; }
function name36() { return other36; }
function* other37() { yield 37; }
function name37() { return other37; }
function* other38() { yield 38; }
function name38() { return other38; }
function* other39() { yield 39; }
function name39() { return other39; }
function* other40() { yield 40; }
function name40() { return other40; }
function* other41() { yield 41; }
function name41() { return other41; }
function* other42() { yield 42; }
function name42() { return other42; }
function* other43() { yield 43; }
function name43() { return other43; }
function* other44() { yield 44; }
function name44() { return other44; }
function* other45() { yield 45; }
function name45() { return other45; }
function* other46() { yield 46; }
function name46() { return other46; }
function* other47() { yield 47; }
function name47() { return other47; }
function* other48() { yield 48; }
function name48() { return other48; }
function* other49() { yield 49; }
function name49() { return other49; }
function* other50() { yield 50; }
function name50() { return other50; }
function* other51() { yield 51; }
function name51() { return other51; }
function* other52() { yield 52; }
function name52() { return other52; }
function* other53() { yield 53; }
function name53() { return other53; }
function* other54() { yield 54; }
function name54() { return other54; }
function* other55() { yield 55; }
function name55() { return other55; }
function* other56() { yield 56; }
function name56() { return other56; }
function* other57() { yield 57; }
function name57() { return other57; }
function* other58() { yield 58; }
function name58() { return other58; }
function* other59() { yield 59; }
function name59() { return other59; }
const runs = [run0, run1, run2, run3, run4, run5, run6, run7, run8, run9, run10, run11];
const installs = [install0, install1, install2, install3, install4, install5, install6, install7, install8, install9, install10, install11];
const namers = [name0, name1, name2, name3, name4, name5, name6, name7, name8, name9, name10, name11, name12, name13, name14, name15, name16, name17, name18, name19, name20, name21, name22, name23, name24, name25, name26, name27, name28, name29, name30, name31, name32, name33, name34, name35, name36, name37, name38, name39, name40, name41, name42, name43, name44, name45, name46, name47, name48, name49, name50, name51, name52, name53, name54, name55, name56, name57, name58, name59];
const kept = [];
let early = 0;
for (const namer of namers) {
  kept.push(namer());
  for (const run of runs) early += run(none);
}
for (const install of installs) install();
let sum = early + kept.length;
const turns = Number(process.argv[2] ?? 30000);
for (const run of runs) sum = (sum + run(turns)) | 0;
console.log(sum);
