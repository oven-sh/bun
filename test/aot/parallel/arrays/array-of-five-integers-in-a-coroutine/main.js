import { Box, show, note, mix, passers, churn, disturb, answerLater, countUp, driveGenerators, driveAsyncGenerators } from "./declared-1.js";
import { driveAsyncFunctions, print } from "./declared-2.js";
let passes = 0;
function pass(value) {
  return passers[passes++ & 1](value);
}
async function* coroutine0(first, second, depth) {
let sum = mix(first, depth);
let kept4, kept3, kept2, kept1;
kept1 = pass(1.5) * 1.25;
{
const ending0 = (pass(2) | 0) + 2;
sum = mix(sum, [ending0]);
}
sum = mix(sum, show(kept3) + show((await Promise.all([pass(3), Promise.resolve(4)]))) + show(kept2));
note("behind 21", kept4, first, kept3, kept1, second, sum);
kept3 = pass(22.5) * 1.25;
{
const ending0 = pass(-0);
const ending1 = BigInt(pass(24)) * 3n;
const ending2 = (pass(25) | 0) + 4;
const ending3 = "s" + pass(26);
const ending4 = new Box(pass(27), 27);
const ending5 = BigInt(pass(28)) * 3n;
const ending6 = pass(-0);
const ending7 = { first: pass(30), second: "t30" };
const ending8 = BigInt(pass(31)) * 3n;
const ending9 = Symbol.for("y" + pass(32));
const ending10 = () => pass(33) + 3;
const ending11 = (pass(34) | 0) + 6;
const ending12 = (pass(35) | 0) + 0;
const ending13 = { first: pass(36), second: "t36" };
const ending14 = Symbol.for("y" + pass(37));
const ending15 = new Box(pass(38), 38);
const ending16 = () => pass(39) + 4;
const ending17 = new Box(pass(40), 40);
const ending18 = (pass(41) | 0) + 6;
const ending19 = pass(undefined);
const ending20 = pass(43) > 42;
const ending21 = (pass(44) | 0) + 2;
const ending22 = [pass(45), 45.5, "u"];
const ending23 = { first: pass(46), second: "t46" };
const ending24 = (pass(47) | 0) + 5;
const ending25 = () => pass(48) + 3;
const ending26 = Symbol.for("y" + pass(49));
const ending27 = (pass(50) | 0) + 1;
const ending28 = "s" + pass(51);
const ending29 = pass(undefined);
const ending30 = Symbol.for("y" + pass(53));
const ending31 = Symbol.for("y" + pass(54));
const ending32 = { first: pass(55), second: "t55" };
const ending33 = pass(56.5) * 1.25;
const ending34 = { first: pass(57), second: "t57" };
const ending35 = { first: pass(58), second: "t58" };
const ending36 = { first: pass(59), second: "t59" };
const ending37 = { first: pass(60), second: "t60" };
const ending38 = "s" + pass(61);
const ending39 = "s" + pass(62);
const ending40 = pass(null);
const ending41 = pass(0) / 0;
const ending42 = Symbol.for("y" + pass(65));
const ending43 = { first: pass(66), second: "t66" };
const ending44 = new Box(pass(67), 67);
const ending45 = pass(0) / 0;
const ending46 = { first: pass(69), second: "t69" };
const ending47 = [pass(70), 70.5, "u"];
const ending48 = { first: pass(71), second: "t71" };
const ending49 = Symbol.for("y" + pass(72));
const ending50 = pass(73) > 72;
const ending51 = (pass(74) | 0) + 4;
const ending52 = pass(75) > 76;
const ending53 = (pass(76) | 0) + 6;
const ending54 = pass(77.5) * 1.25;
const ending55 = (pass(78) | 0) + 1;
const ending56 = Symbol.for("y" + pass(79));
const ending57 = new Box(pass(80), 80);
const ending58 = "s" + pass(81);
const ending59 = [pass(82), 82.5, "u"];
const ending60 = () => pass(83) + 3;
const ending61 = pass(0) / 0;
const ending62 = "s" + pass(85);
const ending63 = "s" + pass(86);
const ending64 = "s" + pass(87);
const ending65 = pass(0) / 0;
sum = mix(sum, ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12, ending13, ending14, ending15, ending16, ending17, ending18, ending19, ending20, ending21, ending22, ending23, ending24, ending25, ending26, ending27, ending28, ending29, ending30, ending31, ending32, ending33, ending34, ending35, ending36, ending37, ending38, ending39, ending40, ending41, ending42, ending43, ending44, ending45, ending46, ending47, ending48, ending49, ending50, ending51, ending52, ending53, ending54, ending55, ending56, ending57, ending58, ending59, ending60, ending61, ending62, ending63, ending64, ending65);
}
sum = mix(sum, depth > 0 ? yield* coroutine0(first, second, depth - 1) : (await null));
try {
try {
{
const ending0 = (pass(90) | 0) + 6;
const ending1 = pass(-0);
const ending2 = (pass(92) | 0) + 1;
const ending3 = pass(93.5) * 1.25;
const ending4 = pass(94.5) * 1.25;
const ending5 = pass(-0);
const ending6 = pass(96.5) * 1.25;
const ending7 = (pass(97) | 0) + 6;
const ending8 = (pass(98) | 0) + 0;
const ending9 = pass(99.5) * 1.25;
const ending10 = (pass(100) | 0) + 2;
const ending11 = (pass(101) | 0) + 3;
const ending12 = pass(0) / 0;
const ending13 = pass(103.5) * 1.25;
const ending14 = pass(104.5) * 1.25;
const ending15 = pass(-0);
const ending16 = pass(0) / 0;
const ending17 = pass(-0);
const ending18 = pass(108.5) * 1.25;
const ending19 = (pass(109) | 0) + 4;
const ending20 = (pass(110) | 0) + 5;
const ending21 = (pass(111) | 0) + 6;
const ending22 = (pass(112) | 0) + 0;
const ending23 = pass(-0);
const ending24 = pass(0) / 0;
const ending25 = pass(115.5) * 1.25;
const ending26 = pass(116.5) * 1.25;
const ending27 = pass(-0);
const ending28 = pass(118.5) * 1.25;
const ending29 = (pass(119) | 0) + 0;
const ending30 = pass(120.5) * 1.25;
const ending31 = (pass(121) | 0) + 2;
const ending32 = pass(122.5) * 1.25;
const ending33 = (pass(123) | 0) + 4;
const ending34 = pass(0) / 0;
const ending35 = pass(-0);
const ending36 = pass(126.5) * 1.25;
const ending37 = (pass(127) | 0) + 1;
const ending38 = (pass(128) | 0) + 2;
const ending39 = pass(-0);
const ending40 = (pass(130) | 0) + 4;
const ending41 = pass(131.5) * 1.25;
const ending42 = (pass(132) | 0) + 6;
const ending43 = (pass(133) | 0) + 0;
const ending44 = pass(134.5) * 1.25;
const ending45 = pass(135.5) * 1.25;
const ending46 = pass(136.5) * 1.25;
const ending47 = (pass(137) | 0) + 4;
const ending48 = (pass(138) | 0) + 5;
const ending49 = (pass(139) | 0) + 6;
const ending50 = pass(140.5) * 1.25;
const ending51 = (pass(141) | 0) + 1;
const ending52 = (pass(142) | 0) + 2;
const ending53 = pass(143.5) * 1.25;
const ending54 = pass(0) / 0;
const ending55 = pass(145.5) * 1.25;
const ending56 = (pass(146) | 0) + 6;
const ending57 = pass(-0);
const ending58 = pass(148.5) * 1.25;
const ending59 = (pass(149) | 0) + 2;
const ending60 = pass(150.5) * 1.25;
const ending61 = (pass(151) | 0) + 4;
const ending62 = pass(152.5) * 1.25;
const ending63 = pass(153.5) * 1.25;
const ending64 = pass(154.5) * 1.25;
sum = mix(sum, ending0 + ending1 + ending2 + ending3 + ending4 + ending5 + ending6 + ending7 + ending8 + ending9 + ending10 + ending11 + ending12 + ending13 + ending14 + ending15 + ending16 + ending17 + ending18 + ending19 + ending20 + ending21 + ending22 + ending23 + ending24 + ending25 + ending26 + ending27 + ending28 + ending29 + ending30 + ending31 + ending32 + ending33 + ending34 + ending35 + ending36 + ending37 + ending38 + ending39 + ending40 + ending41 + ending42 + ending43 + ending44 + ending45 + ending46 + ending47 + ending48 + ending49 + ending50 + ending51 + ending52 + ending53 + ending54 + ending55 + ending56 + ending57 + ending58 + ending59 + ending60 + ending61 + ending62 + ending63 + ending64);
}
sum = mix(sum, new Box(kept1, (await Promise.resolve(pass(155)))));
sum = mix(sum, { first: first, second: (yield* countUp(169)), third: kept4 });
kept1 = Symbol.for("y" + pass(177));
kept3 = [pass(178), 178.5, "u"];
sum = mix(sum, Array.of(new Box(pass(181), 181), { first: pass(182), second: "t182" }, Symbol.for("y" + pass(183)), (pass(184) | 0) + 2, pass(185.5) * 1.25, pass(186) > 187, new Box(pass(187), 187), pass(undefined), new Box(pass(189), 189), (await Promise.all([pass(179), Promise.resolve(180)])), first));
Bun.gc(true);
}
catch (error) {
note("caught 191", error);
note("in the catch 192", kept2, kept3, kept4, first, sum);
}
finally {
note("in the finally 193", kept2, kept4, sum);
kept2 = [pass(194), 194.5, "u"];
kept4 = (pass(195) | 0) + 6;
kept1 = () => pass(196) + 1;
{
const ending0 = "s" + pass(197);
const ending1 = "s" + pass(198);
sum = mix(sum, ending1);
sum = mix(sum, ending0);
}
(await Promise.all([pass(199), Promise.resolve(200)]));
Bun.gc(true);
note("behind 215", kept3, second, kept1, sum);
}
try {
{
const ending0 = (pass(216) | 0) + 6;
const ending1 = pass(-0);
const ending2 = (pass(218) | 0) + 1;
const ending3 = (pass(219) | 0) + 2;
const ending4 = pass(220.5) * 1.25;
const ending5 = pass(-0);
const ending6 = pass(222.5) * 1.25;
const ending7 = pass(223.5) * 1.25;
const ending8 = pass(0) / 0;
const ending9 = pass(-0);
const ending10 = (pass(226) | 0) + 2;
const ending11 = (pass(227) | 0) + 3;
const ending12 = pass(0) / 0;
sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12));
}
sum = mix(kept2, (yield pass(229)), second);
note("behind 241", kept4, second, kept2, first, sum);
kept4 = (pass(242) | 0) + 4;
kept2 = () => pass(243) + 3;
kept1 = BigInt(pass(244)) * 3n;
{
const ending0 = "s" + pass(245);
const ending1 = BigInt(pass(246)) * 3n;
const ending2 = pass(null);
const ending3 = { first: pass(248), second: "t248" };
const ending4 = pass(null);
const ending5 = () => pass(250) + 0;
const ending6 = pass(251) > 250;
const ending7 = pass(undefined);
const ending8 = pass(253) > 252;
const ending9 = pass(254.5) * 1.25;
const ending10 = pass(-0);
const ending11 = BigInt(pass(256)) * 3n;
const ending12 = () => pass(257) + 2;
const ending13 = pass(258) > 259;
const ending14 = Symbol.for("y" + pass(259));
const ending15 = () => pass(260) + 0;
sum = mix(sum, ending15);
sum = mix(sum, ending14);
sum = mix(sum, ending13);
sum = mix(sum, ending12);
sum = mix(sum, ending11);
sum = mix(sum, ending10);
sum = mix(sum, ending9);
sum = mix(sum, ending8);
sum = mix(sum, ending7);
sum = mix(sum, ending6);
sum = mix(sum, ending5);
sum = mix(sum, ending4);
sum = mix(sum, ending3);
sum = mix(sum, ending2);
sum = mix(sum, ending1);
sum = mix(sum, ending0);
}
(yield* [261, 262]);
Bun.gc(true);
note("behind 271", kept3, second, kept2, kept1, first, sum);
}
catch (error) {
note("caught 272", error);
note("in the catch 273", second, kept2, first, sum);
}
finally {
note("in the finally 274", kept2, kept3, kept4, second, sum);
kept3 = { first: pass(275), second: "t275" };
kept1 = Symbol.for("y" + pass(276));
{
const ending0 = pass(277.5) * 1.25;
const ending1 = pass(0) / 0;
const ending2 = pass(279.5) * 1.25;
sum = mix(sum, Math.max(ending0, ending1, ending2), Math.min(ending0, ending1, ending2));
}
sum = mix(sum, { first: kept4, second: (yield mix(sum, 280)), third: second });
Bun.gc(true);
note("behind 304", kept1, kept4, kept3, sum);
}
{
const ending0 = (pass(305) | 0) + 4;
const ending1 = pass(0) / 0;
const ending2 = pass(307.5) * 1.25;
sum = mix(sum, Array.of(ending0, ending1, ending2));
}
(await { then(resolve, reject) { disturb(); reject(new Error("refused 308")); } });
try {
kept3 = { first: pass(340), second: "t340" };
{
const ending0 = pass(-0);
const ending1 = pass(342.5) * 1.25;
const ending2 = (pass(343) | 0) + 0;
const ending3 = pass(344.5) * 1.25;
const ending4 = (pass(345) | 0) + 2;
const ending5 = pass(346.5) * 1.25;
const ending6 = (pass(347) | 0) + 4;
const ending7 = pass(348.5) * 1.25;
const ending8 = pass(349.5) * 1.25;
const ending9 = pass(350.5) * 1.25;
const ending10 = (pass(351) | 0) + 1;
const ending11 = (pass(352) | 0) + 2;
const ending12 = pass(353.5) * 1.25;
sum = mix(sum, ending12);
sum = mix(sum, ending11);
sum = mix(sum, ending10);
sum = mix(sum, ending9);
sum = mix(sum, ending8);
sum = mix(sum, ending7);
sum = mix(sum, ending6);
sum = mix(sum, ending5);
sum = mix(sum, ending4);
sum = mix(sum, ending3);
sum = mix(sum, ending2);
sum = mix(sum, ending1);
sum = mix(sum, ending0);
}
sum = mix(sum, (await pass(354)) ? kept1 : second);
note("behind 367", second, kept2, sum);
kept3 = (pass(368) | 0) + 4;
sum = mix(sum, [second, (yield* [369, 370]), second]);
churn(50);
}
finally {
note("in the finally 385", kept2, second, sum);
}
}
catch (error) {
note("caught 386", error);
note("in the catch 387", kept4, kept3, kept2, second, sum);
}
{
const ending0 = pass(0) / 0;
sum = mix(sum, ending0);
}
note("before 389", second, first, kept3, sum);
sum = mix(sum, Array.of(kept4, (await Promise.resolve(pass(390))), kept1, (yield mix(sum, 391)), kept4));
note("behind 423", kept2, kept4, first, sum);
note("end", first, second, kept4, kept3, kept2, kept1, sum);
return sum;
}
const holderOfcoroutine1 = {
*run(first, second, depth) {
let sum = mix(first, depth);
let kept21, kept20, kept19, kept18, kept17, kept16, kept15, kept14, kept13, kept12, kept11, kept10, kept9, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1;
kept16 = pass(1) > 0;
kept17 = (pass(2) | 0) + 2;
kept21 = BigInt(pass(3)) * 3n;
kept18 = (pass(4) | 0) + 4;
kept20 = () => pass(5) + 0;
kept5 = new Box(pass(6), 6);
kept1 = Symbol.for("y" + pass(7));
kept13 = new Box(pass(8), 8);
kept3 = pass(-0);
kept10 = "s" + pass(10);
kept11 = (pass(11) | 0) + 4;
kept7 = { first: pass(12), second: "t12" };
kept15 = Symbol.for("y" + pass(13));
kept12 = (pass(14) | 0) + 0;
kept19 = new Box(pass(15), 15);
kept14 = BigInt(pass(16)) * 3n;
kept2 = { first: pass(17), second: "t17" };
{
const ending0 = pass(18) > 19;
const ending1 = pass(19) > 18;
const ending2 = pass(20) > 19;
const ending3 = { first: pass(21), second: "t21" };
const ending4 = { first: pass(22), second: "t22" };
const ending5 = { first: pass(23), second: "t23" };
const ending6 = () => pass(24) + 4;
const ending7 = (pass(25) | 0) + 4;
const ending8 = pass(26.5) * 1.25;
const ending9 = (pass(27) | 0) + 6;
const ending10 = Symbol.for("y" + pass(28));
const ending11 = pass(29.5) * 1.25;
const ending12 = new Box(pass(30), 30);
const ending13 = pass(31.5) * 1.25;
const ending14 = { first: pass(32), second: "t32" };
const ending15 = { first: pass(33), second: "t33" };
const ending16 = BigInt(pass(34)) * 3n;
const ending17 = pass(-0);
const ending18 = pass(undefined);
const ending19 = Symbol.for("y" + pass(37));
const ending20 = pass(38) > 37;
const ending21 = new Box(pass(39), 39);
const ending22 = new Box(pass(40), 40);
const ending23 = pass(41.5) * 1.25;
sum = mix(sum, [ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12, ending13, ending14, ending15, ending16, ending17, ending18, ending19, ending20, ending21, ending22, ending23]);
}
sum = mix(sum, depth > 0 ? yield* holderOfcoroutine1.run(kept21, second, depth - 1) : (yield 42));
note("behind 43", kept5, kept19, sum);
kept5 = BigInt(pass(44)) * 3n;
kept12 = new Box(pass(45), 45);
kept3 = [pass(46), 46.5, "u"];
kept11 = BigInt(pass(47)) * 3n;
kept16 = () => pass(48) + 3;
kept6 = { first: pass(49), second: "t49" };
kept8 = "s" + pass(50);
kept20 = { first: pass(51), second: "t51" };
kept1 = () => pass(52) + 2;
kept21 = pass(-0);
kept10 = () => pass(54) + 4;
kept14 = "s" + pass(55);
kept7 = BigInt(pass(56)) * 3n;
{
const ending0 = pass(57.5) * 1.25;
const ending1 = { first: pass(58), second: "t58" };
const ending2 = "s" + pass(59);
const ending3 = "s" + pass(60);
const ending4 = Symbol.for("y" + pass(61));
const ending5 = pass(62) > 61;
const ending6 = "s" + pass(63);
const ending7 = () => pass(64) + 4;
const ending8 = (pass(65) | 0) + 2;
const ending9 = "s" + pass(66);
const ending10 = BigInt(pass(67)) * 3n;
const ending11 = pass(68.5) * 1.25;
const ending12 = BigInt(pass(69)) * 3n;
const ending13 = pass(0) / 0;
const ending14 = BigInt(pass(71)) * 3n;
const ending15 = pass(72) > 73;
sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12, ending13, ending14, ending15));
}
note("before 73", kept10, kept16, kept1, kept12, second, kept5, kept14, kept8, sum);
sum = mix(sum, new Box(kept15, (yield 74)));
churn(50);
note("behind 104", kept3, kept17, kept15, kept9, kept4, kept11, kept16, kept7, kept6, kept18, kept2, sum);
for (let turn105 = 0; turn105 < 4; turn105++) {
kept7 = () => pass(106) + 1;
kept5 = () => pass(107) + 2;
{
const ending0 = (pass(108) | 0) + 3;
const ending1 = pass(-0);
const ending2 = (pass(110) | 0) + 5;
const ending3 = (pass(111) | 0) + 6;
const ending4 = pass(0) / 0;
const ending5 = pass(113.5) * 1.25;
const ending6 = (pass(114) | 0) + 2;
const ending7 = pass(115.5) * 1.25;
const ending8 = (pass(116) | 0) + 4;
const ending9 = pass(117.5) * 1.25;
const ending10 = pass(118.5) * 1.25;
const ending11 = pass(-0);
const ending12 = (pass(120) | 0) + 1;
const ending13 = (pass(121) | 0) + 2;
const ending14 = pass(0) / 0;
const ending15 = (pass(123) | 0) + 4;
const ending16 = pass(0) / 0;
const ending17 = (pass(125) | 0) + 6;
const ending18 = pass(0) / 0;
const ending19 = (pass(127) | 0) + 1;
const ending20 = pass(128.5) * 1.25;
const ending21 = pass(-0);
const ending22 = (pass(130) | 0) + 4;
const ending23 = pass(-0);
sum = mix(sum, ending0 + ending1 + ending2 + ending3 + ending4 + ending5 + ending6 + ending7 + ending8 + ending9 + ending10 + ending11 + ending12 + ending13 + ending14 + ending15 + ending16 + ending17 + ending18 + ending19 + ending20 + ending21 + ending22 + ending23);
}
sum = mix(second, (yield mix(sum, 132)), kept20);
disturb();
note("behind 153", kept21, sum);
if (turn105 === 1) note("one turn 154", kept5, sum);
sum = mix(sum, turn105);
}
try {
kept5 = () => pass(155) + 0;
kept19 = Symbol.for("y" + pass(156));
kept12 = pass(157) > 156;
{
const ending0 = (pass(158) | 0) + 4;
const ending1 = pass(-0);
const ending2 = (pass(160) | 0) + 6;
const ending3 = (pass(161) | 0) + 0;
const ending4 = (pass(162) | 0) + 1;
const ending5 = pass(163.5) * 1.25;
const ending6 = pass(0) / 0;
const ending7 = (pass(165) | 0) + 4;
sum = mix(sum, ending7);
sum = mix(sum, ending6);
sum = mix(sum, ending5);
sum = mix(sum, ending4);
sum = mix(sum, ending3);
sum = mix(sum, ending2);
sum = mix(sum, ending1);
sum = mix(sum, ending0);
}
(yield* [166, 167]);
note("behind 188", kept5, kept6, kept20, kept12, sum);
{
const ending0 = [pass(189), 189.5, "u"];
const ending1 = (pass(190) | 0) + 1;
const ending2 = { first: pass(191), second: "t191" };
const ending3 = pass(192.5) * 1.25;
const ending4 = () => pass(193) + 3;
const ending5 = [pass(194), 194.5, "u"];
const ending6 = [pass(195), 195.5, "u"];
const ending7 = pass(0) / 0;
const ending8 = { first: pass(197), second: "t197" };
const ending9 = BigInt(pass(198)) * 3n;
const ending10 = Symbol.for("y" + pass(199));
const ending11 = pass(200) > 199;
const ending12 = BigInt(pass(201)) * 3n;
sum = mix(sum, ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12);
}
(yield 202);
kept1 = pass(null);
kept8 = [pass(222), 222.5, "u"];
kept7 = pass(-0);
{
const ending0 = pass(224.5) * 1.25;
const ending1 = pass(225.5) * 1.25;
const ending2 = pass(0) / 0;
const ending3 = pass(227.5) * 1.25;
const ending4 = pass(228.5) * 1.25;
const ending5 = (pass(229) | 0) + 5;
const ending6 = pass(0) / 0;
const ending7 = pass(231.5) * 1.25;
sum = mix(sum, ending0 + ending1 + ending2 + ending3 + ending4 + ending5 + ending6 + ending7);
}
note("before 232", kept9, kept4, sum);
sum = mix(kept19, (yield* [233, 234]), kept13);
disturb();
note("behind 243", kept20, kept16, sum);
}
finally {
note("in the finally 244", kept15, kept17, kept6, kept12, kept1, kept14, second, kept5, kept10, kept20, kept8, kept7, kept2, kept3, kept18, kept21, sum);
}
note("end", first, second, kept21, kept20, kept19, kept18, kept17, kept16, kept15, kept14, kept13, kept12, kept11, kept10, kept9, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1, sum);
return sum;
},
};
async function coroutine2(first, second, depth) {
let sum = mix(first, depth);
let kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1;
try {
{
const ending0 = (pass(1) | 0) + 1;
const ending1 = pass(0) / 0;
const ending2 = pass(3.5) * 1.25;
const ending3 = (pass(4) | 0) + 4;
const ending4 = pass(5.5) * 1.25;
const ending5 = pass(6.5) * 1.25;
const ending6 = (pass(7) | 0) + 0;
const ending7 = pass(8.5) * 1.25;
const ending8 = pass(9.5) * 1.25;
const ending9 = (pass(10) | 0) + 3;
const ending10 = (pass(11) | 0) + 4;
const ending11 = (pass(12) | 0) + 5;
const ending12 = (pass(13) | 0) + 6;
sum = mix(sum, ending0 + ending1 + ending2 + ending3 + ending4 + ending5 + ending6 + ending7 + ending8 + ending9 + ending10 + ending11 + ending12);
}
sum = mix(sum, { first: first, second: (await pass(14)), third: kept1 });
note("behind 35", kept4, kept7, kept5, second, kept8, kept3, kept6, kept1, kept2, sum);
kept6 = (pass(36) | 0) + 1;
kept5 = BigInt(pass(37)) * 3n;
kept3 = pass(38) > 37;
{
const ending0 = (pass(39) | 0) + 4;
const ending1 = pass(0) / 0;
const ending2 = pass(41.5) * 1.25;
const ending3 = pass(0) / 0;
const ending4 = pass(43.5) * 1.25;
const ending5 = pass(0) / 0;
const ending6 = pass(-0);
const ending7 = pass(0) / 0;
const ending8 = pass(47.5) * 1.25;
const ending9 = pass(48.5) * 1.25;
const ending10 = pass(-0);
const ending11 = pass(0) / 0;
const ending12 = (pass(51) | 0) + 2;
sum = mix(sum, ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12);
}
sum = mix(sum, new Box(kept7, (await Promise.reject(new Error("rejected 52")))));
note("behind 73", kept8, kept3, kept7, sum);
for (let turn74 = 0; turn74 < 2; turn74++) {
kept1 = pass(-0);
{
const ending0 = (pass(76) | 0) + 6;
const ending1 = (pass(77) | 0) + 0;
const ending2 = (pass(78) | 0) + 1;
const ending3 = (pass(79) | 0) + 2;
const ending4 = (pass(80) | 0) + 3;
sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4));
}
sum = mix(sum, (await answerLater(81)) ? kept4 : first);
Bun.gc(true);
note("behind 114", second, sum);
kept6 = "s" + pass(115);
kept2 = pass(116.5) * 1.25;
{
const ending0 = pass(117) > 118;
const ending1 = pass(118) > 117;
const ending2 = pass(119.5) * 1.25;
const ending3 = pass(0) / 0;
const ending4 = pass(-0);
const ending5 = Symbol.for("y" + pass(122));
const ending6 = pass(null);
const ending7 = [pass(124), 124.5, "u"];
const ending8 = { first: pass(125), second: "t125" };
const ending9 = () => pass(126) + 1;
const ending10 = [pass(127), 127.5, "u"];
const ending11 = pass(128) > 127;
const ending12 = Symbol.for("y" + pass(129));
const ending13 = pass(130.5) * 1.25;
const ending14 = [pass(131), 131.5, "u"];
const ending15 = pass(132.5) * 1.25;
sum = mix(sum, [ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12, ending13, ending14, ending15]);
}
note("before 133", kept1, second, kept8, kept6, kept3, kept5, kept7, first, kept4, kept2, sum);
(await pass(134));
note("behind 167", kept5, kept6, kept4, first, sum);
if (turn74 === 0) note("one turn 168", kept5, kept7, second, kept6, first, kept1, kept2, kept8, kept3, kept4, sum);
sum = mix(sum, turn74);
}
for (let turn169 = 0; turn169 < 2; turn169++) {
kept3 = pass(170.5) * 1.25;
{
const ending0 = { first: pass(171), second: "t171" };
const ending1 = BigInt(pass(172)) * 3n;
const ending2 = BigInt(pass(173)) * 3n;
const ending3 = "s" + pass(174);
const ending4 = pass(null);
const ending5 = [pass(176), 176.5, "u"];
const ending6 = Symbol.for("y" + pass(177));
const ending7 = "s" + pass(178);
const ending8 = [pass(179), 179.5, "u"];
const ending9 = () => pass(180) + 0;
const ending10 = () => pass(181) + 1;
const ending11 = pass(182) > 181;
const ending12 = pass(183) > 184;
const ending13 = "s" + pass(184);
const ending14 = BigInt(pass(185)) * 3n;
const ending15 = pass(186.5) * 1.25;
const ending16 = { first: pass(187), second: "t187" };
const ending17 = Symbol.for("y" + pass(188));
const ending18 = [pass(189), 189.5, "u"];
const ending19 = BigInt(pass(190)) * 3n;
const ending20 = { first: pass(191), second: "t191" };
const ending21 = pass(192.5) * 1.25;
const ending22 = new Box(pass(193), 193);
const ending23 = pass(undefined);
const list = [];
list.push(ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12, ending13, ending14, ending15, ending16, ending17, ending18, ending19, ending20, ending21, ending22, ending23);
sum = mix(sum, list.splice(0));
}
sum = mix(sum, new Box(kept4, (await new Promise(resolve => setTimeout(resolve, 0, 195)))));
kept8 = { first: pass(208), second: "t208" };
kept7 = "s" + pass(209);
{
const ending0 = Symbol.for("y" + pass(210));
const ending1 = pass(211.5) * 1.25;
const ending2 = "s" + pass(212);
const ending3 = pass(213.5) * 1.25;
const ending4 = pass(undefined);
sum = mix(sum, ending4);
sum = mix(sum, ending3);
sum = mix(sum, ending2);
sum = mix(sum, ending1);
sum = mix(sum, ending0);
}
sum = mix(sum, (await Promise.resolve(pass(215))));
note("behind 229", first, kept4, sum);
if (turn169 === 0) note("one turn 230", kept4, sum);
sum = mix(sum, turn169);
}
}
catch (error) {
note("caught 231", error);
note("in the catch 232", first, kept3, kept4, kept1, sum);
}
finally {
note("in the finally 233", second, sum);
}
try {
{
const ending0 = pass(undefined);
const ending1 = pass(235.5) * 1.25;
sum = mix(sum, Array.of(ending0, ending1));
}
sum = mix(sum, new Box(kept5, (await { then(resolve) { disturb(); resolve(236); } })));
note("behind 242", kept5, kept6, kept3, sum);
{
const ending0 = pass(-0);
const ending1 = (pass(244) | 0) + 6;
const ending2 = pass(-0);
const ending3 = pass(246.5) * 1.25;
const ending4 = (pass(247) | 0) + 2;
const ending5 = pass(248.5) * 1.25;
const ending6 = pass(-0);
const ending7 = (pass(250) | 0) + 5;
const ending8 = pass(251.5) * 1.25;
const ending9 = (pass(252) | 0) + 0;
const ending10 = pass(-0);
const ending11 = pass(254.5) * 1.25;
const ending12 = (pass(255) | 0) + 3;
sum = mix(sum, [ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12]);
}
sum = mix(kept8, (await Promise.all([pass(256), Promise.resolve(257)])), kept5);
note("behind 279", first, kept4, kept8, kept3, kept7, second, kept5, sum);
}
finally {
note("in the finally 280", kept6, kept1, sum);
}
for (let turn281 = 0; turn281 < 2; turn281++) {
kept7 = new Box(pass(282), 282);
kept5 = () => pass(283) + 3;
{
const ending0 = new Box(pass(284), 284);
const ending1 = () => pass(285) + 0;
const ending2 = new Box(pass(286), 286);
sum = mix(sum, [ending0, ending1, ending2]);
}
sum = mix(sum, show(kept7) + show((await Promise.resolve(pass(287)))) + show(kept1));
for (let turn318 = 0; turn318 < 4; turn318++) {
{
const ending0 = (pass(319) | 0) + 4;
const ending1 = (pass(320) | 0) + 5;
const ending2 = (pass(321) | 0) + 6;
const ending3 = pass(0) / 0;
const ending4 = pass(323.5) * 1.25;
const ending5 = (pass(324) | 0) + 2;
const ending6 = (pass(325) | 0) + 3;
const ending7 = pass(0) / 0;
const ending8 = pass(327.5) * 1.25;
const ending9 = (pass(328) | 0) + 6;
const ending10 = pass(329.5) * 1.25;
const ending11 = (pass(330) | 0) + 1;
const ending12 = (pass(331) | 0) + 2;
const ending13 = pass(332.5) * 1.25;
const ending14 = pass(-0);
const ending15 = (pass(334) | 0) + 5;
sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7, ending8, ending9, ending10, ending11, ending12, ending13, ending14, ending15));
}
note("before 335", first, kept4, kept8, second, sum);
sum = mix(sum, new Box(kept7, (await answerLater(336))));
churn(50);
if (turn318 === 3) note("one turn 364", kept4, kept2, first, kept5, sum);
sum = mix(sum, turn318);
}
if (turn281 === 1) note("one turn 365", kept7, sum);
sum = mix(sum, turn281);
}
note("end", first, second, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1, sum);
return sum;
}
async function main() {
await driveAsyncGenerators("async generator 0", [coroutine0(1, "a", 0), coroutine0(7n, null, 0), coroutine0([1, 2], [1, 2], 0)], ["next", "next", "next", "next", "next", "next"]);
driveGenerators("generator method 1", [holderOfcoroutine1.run(7n, "a", 1), holderOfcoroutine1.run(7n, "a", 1)], ["next", "return", "next", "next", "next", "next", "next", "next", "next"]);
for (let time = 0; time < 3; time++) {
await driveAsyncFunctions("async function 2", [coroutine2(2.5, 7n, 1)]);
}
}
main().then(print, error => {
  note("main failed", error);
  print();
});
