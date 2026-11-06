// Objects with hundreds of own properties: values, functions that are called, getters and setters. A property has its place in the table by name however far out of line it lies: every answer is that of the language, and the run time is asked once.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTGetByIdAndCache") + count("operationAOTPutByIdAndCache");
const makeValues = seed => ({
  p0: seed + 0, p1: seed + 1, p2: seed + 2, p3: seed + 3, p4: seed + 4, p5: seed + 5, p6: seed + 6, p7: seed + 7, p8: seed + 8, p9: seed + 9,
  p10: seed + 10, p11: seed + 11, p12: seed + 12, p13: seed + 13, p14: seed + 14, p15: seed + 15, p16: seed + 16, p17: seed + 17, p18: seed + 18, p19: seed + 19,
  p20: seed + 20, p21: seed + 21, p22: seed + 22, p23: seed + 23, p24: seed + 24, p25: seed + 25, p26: seed + 26, p27: seed + 27, p28: seed + 28, p29: seed + 29,
  p30: seed + 30, p31: seed + 31, p32: seed + 32, p33: seed + 33, p34: seed + 34, p35: seed + 35, p36: seed + 36, p37: seed + 37, p38: seed + 38, p39: seed + 39,
  p40: seed + 40, p41: seed + 41, p42: seed + 42, p43: seed + 43, p44: seed + 44, p45: seed + 45, p46: seed + 46, p47: seed + 47, p48: seed + 48, p49: seed + 49,
  p50: seed + 50, p51: seed + 51, p52: seed + 52, p53: seed + 53, p54: seed + 54, p55: seed + 55, p56: seed + 56, p57: seed + 57, p58: seed + 58, p59: seed + 59,
  p60: seed + 60, p61: seed + 61, p62: seed + 62, p63: seed + 63, p64: seed + 64, p65: seed + 65, p66: seed + 66, p67: seed + 67, p68: seed + 68, p69: seed + 69,
  p70: seed + 70, p71: seed + 71, p72: seed + 72, p73: seed + 73, p74: seed + 74, p75: seed + 75, p76: seed + 76, p77: seed + 77, p78: seed + 78, p79: seed + 79,
  p80: seed + 80, p81: seed + 81, p82: seed + 82, p83: seed + 83, p84: seed + 84, p85: seed + 85, p86: seed + 86, p87: seed + 87, p88: seed + 88, p89: seed + 89,
  p90: seed + 90, p91: seed + 91, p92: seed + 92, p93: seed + 93, p94: seed + 94, p95: seed + 95, p96: seed + 96, p97: seed + 97, p98: seed + 98, p99: seed + 99,
  p100: seed + 100, p101: seed + 101, p102: seed + 102, p103: seed + 103, p104: seed + 104, p105: seed + 105, p106: seed + 106, p107: seed + 107, p108: seed + 108, p109: seed + 109,
  p110: seed + 110, p111: seed + 111, p112: seed + 112, p113: seed + 113, p114: seed + 114, p115: seed + 115, p116: seed + 116, p117: seed + 117, p118: seed + 118, p119: seed + 119,
  p120: seed + 120, p121: seed + 121, p122: seed + 122, p123: seed + 123, p124: seed + 124, p125: seed + 125, p126: seed + 126, p127: seed + 127, p128: seed + 128, p129: seed + 129,
  p130: seed + 130, p131: seed + 131, p132: seed + 132, p133: seed + 133, p134: seed + 134, p135: seed + 135, p136: seed + 136, p137: seed + 137, p138: seed + 138, p139: seed + 139,
  p140: seed + 140, p141: seed + 141, p142: seed + 142, p143: seed + 143, p144: seed + 144, p145: seed + 145, p146: seed + 146, p147: seed + 147, p148: seed + 148, p149: seed + 149,
  p150: seed + 150, p151: seed + 151, p152: seed + 152, p153: seed + 153, p154: seed + 154, p155: seed + 155, p156: seed + 156, p157: seed + 157, p158: seed + 158, p159: seed + 159,
  p160: seed + 160, p161: seed + 161, p162: seed + 162, p163: seed + 163, p164: seed + 164, p165: seed + 165, p166: seed + 166, p167: seed + 167, p168: seed + 168, p169: seed + 169,
  p170: seed + 170, p171: seed + 171, p172: seed + 172, p173: seed + 173, p174: seed + 174, p175: seed + 175, p176: seed + 176, p177: seed + 177, p178: seed + 178, p179: seed + 179,
  p180: seed + 180, p181: seed + 181, p182: seed + 182, p183: seed + 183, p184: seed + 184, p185: seed + 185, p186: seed + 186, p187: seed + 187, p188: seed + 188, p189: seed + 189,
  p190: seed + 190, p191: seed + 191, p192: seed + 192, p193: seed + 193, p194: seed + 194, p195: seed + 195, p196: seed + 196, p197: seed + 197, p198: seed + 198, p199: seed + 199,
  p200: seed + 200, p201: seed + 201, p202: seed + 202, p203: seed + 203, p204: seed + 204, p205: seed + 205, p206: seed + 206, p207: seed + 207, p208: seed + 208, p209: seed + 209,
  p210: seed + 210, p211: seed + 211, p212: seed + 212, p213: seed + 213, p214: seed + 214, p215: seed + 215, p216: seed + 216, p217: seed + 217, p218: seed + 218, p219: seed + 219,
  p220: seed + 220, p221: seed + 221, p222: seed + 222, p223: seed + 223, p224: seed + 224, p225: seed + 225, p226: seed + 226, p227: seed + 227, p228: seed + 228, p229: seed + 229,
  p230: seed + 230, p231: seed + 231, p232: seed + 232, p233: seed + 233, p234: seed + 234, p235: seed + 235, p236: seed + 236, p237: seed + 237, p238: seed + 238, p239: seed + 239,
  p240: seed + 240, p241: seed + 241, p242: seed + 242, p243: seed + 243, p244: seed + 244, p245: seed + 245, p246: seed + 246, p247: seed + 247, p248: seed + 248, p249: seed + 249,
  p250: seed + 250, p251: seed + 251, p252: seed + 252, p253: seed + 253, p254: seed + 254, p255: seed + 255, p256: seed + 256, p257: seed + 257, p258: seed + 258, p259: seed + 259,
  p260: seed + 260, p261: seed + 261, p262: seed + 262, p263: seed + 263, p264: seed + 264, p265: seed + 265, p266: seed + 266, p267: seed + 267, p268: seed + 268, p269: seed + 269,
  p270: seed + 270, p271: seed + 271, p272: seed + 272, p273: seed + 273, p274: seed + 274, p275: seed + 275, p276: seed + 276, p277: seed + 277, p278: seed + 278, p279: seed + 279,
  p280: seed + 280, p281: seed + 281, p282: seed + 282, p283: seed + 283, p284: seed + 284, p285: seed + 285, p286: seed + 286, p287: seed + 287, p288: seed + 288, p289: seed + 289,
  p290: seed + 290, p291: seed + 291, p292: seed + 292, p293: seed + 293, p294: seed + 294, p295: seed + 295, p296: seed + 296, p297: seed + 297, p298: seed + 298, p299: seed + 299,
  p300: seed + 300, p301: seed + 301, p302: seed + 302, p303: seed + 303, p304: seed + 304, p305: seed + 305, p306: seed + 306, p307: seed + 307, p308: seed + 308, p309: seed + 309,
  p310: seed + 310, p311: seed + 311, p312: seed + 312, p313: seed + 313, p314: seed + 314, p315: seed + 315, p316: seed + 316, p317: seed + 317, p318: seed + 318, p319: seed + 319,
  p320: seed + 320, p321: seed + 321, p322: seed + 322, p323: seed + 323, p324: seed + 324, p325: seed + 325, p326: seed + 326, p327: seed + 327, p328: seed + 328, p329: seed + 329,
  p330: seed + 330, p331: seed + 331, p332: seed + 332, p333: seed + 333, p334: seed + 334, p335: seed + 335, p336: seed + 336, p337: seed + 337, p338: seed + 338, p339: seed + 339,
  p340: seed + 340, p341: seed + 341, p342: seed + 342, p343: seed + 343, p344: seed + 344, p345: seed + 345, p346: seed + 346, p347: seed + 347, p348: seed + 348, p349: seed + 349,
  p350: seed + 350, p351: seed + 351, p352: seed + 352, p353: seed + 353, p354: seed + 354, p355: seed + 355, p356: seed + 356, p357: seed + 357, p358: seed + 358, p359: seed + 359,
  p360: seed + 360, p361: seed + 361, p362: seed + 362, p363: seed + 363, p364: seed + 364, p365: seed + 365, p366: seed + 366, p367: seed + 367, p368: seed + 368, p369: seed + 369,
  p370: seed + 370, p371: seed + 371, p372: seed + 372, p373: seed + 373, p374: seed + 374, p375: seed + 375, p376: seed + 376, p377: seed + 377, p378: seed + 378, p379: seed + 379,
  p380: seed + 380, p381: seed + 381, p382: seed + 382, p383: seed + 383, p384: seed + 384, p385: seed + 385, p386: seed + 386, p387: seed + 387, p388: seed + 388, p389: seed + 389,
  p390: seed + 390, p391: seed + 391, p392: seed + 392, p393: seed + 393, p394: seed + 394, p395: seed + 395, p396: seed + 396, p397: seed + 397, p398: seed + 398, p399: seed + 399,
});
const adder = n => function (x) { return this.base + x + n; };
const makeTools = base => ({
  base,
  f0: adder(0), f1: adder(1), f2: adder(2), f3: adder(3), f4: adder(4), f5: adder(5), f6: adder(6), f7: adder(7), f8: adder(8), f9: adder(9),
  f10: adder(10), f11: adder(11), f12: adder(12), f13: adder(13), f14: adder(14), f15: adder(15), f16: adder(16), f17: adder(17), f18: adder(18), f19: adder(19),
  f20: adder(20), f21: adder(21), f22: adder(22), f23: adder(23), f24: adder(24), f25: adder(25), f26: adder(26), f27: adder(27), f28: adder(28), f29: adder(29),
  f30: adder(30), f31: adder(31), f32: adder(32), f33: adder(33), f34: adder(34), f35: adder(35), f36: adder(36), f37: adder(37), f38: adder(38), f39: adder(39),
  f40: adder(40), f41: adder(41), f42: adder(42), f43: adder(43), f44: adder(44), f45: adder(45), f46: adder(46), f47: adder(47), f48: adder(48), f49: adder(49),
  f50: adder(50), f51: adder(51), f52: adder(52), f53: adder(53), f54: adder(54), f55: adder(55), f56: adder(56), f57: adder(57), f58: adder(58), f59: adder(59),
  f60: adder(60), f61: adder(61), f62: adder(62), f63: adder(63), f64: adder(64), f65: adder(65), f66: adder(66), f67: adder(67), f68: adder(68), f69: adder(69),
  f70: adder(70), f71: adder(71), f72: adder(72), f73: adder(73), f74: adder(74), f75: adder(75), f76: adder(76), f77: adder(77), f78: adder(78), f79: adder(79),
  f80: adder(80), f81: adder(81), f82: adder(82), f83: adder(83), f84: adder(84), f85: adder(85), f86: adder(86), f87: adder(87), f88: adder(88), f89: adder(89),
  f90: adder(90), f91: adder(91), f92: adder(92), f93: adder(93), f94: adder(94), f95: adder(95), f96: adder(96), f97: adder(97), f98: adder(98), f99: adder(99),
  f100: adder(100), f101: adder(101), f102: adder(102), f103: adder(103), f104: adder(104), f105: adder(105), f106: adder(106), f107: adder(107), f108: adder(108), f109: adder(109),
  f110: adder(110), f111: adder(111), f112: adder(112), f113: adder(113), f114: adder(114), f115: adder(115), f116: adder(116), f117: adder(117), f118: adder(118), f119: adder(119),
  f120: adder(120), f121: adder(121), f122: adder(122), f123: adder(123), f124: adder(124), f125: adder(125), f126: adder(126), f127: adder(127), f128: adder(128), f129: adder(129),
  f130: adder(130), f131: adder(131), f132: adder(132), f133: adder(133), f134: adder(134), f135: adder(135), f136: adder(136), f137: adder(137), f138: adder(138), f139: adder(139),
  f140: adder(140), f141: adder(141), f142: adder(142), f143: adder(143), f144: adder(144), f145: adder(145), f146: adder(146), f147: adder(147), f148: adder(148), f149: adder(149),
  f150: adder(150), f151: adder(151), f152: adder(152), f153: adder(153), f154: adder(154), f155: adder(155), f156: adder(156), f157: adder(157), f158: adder(158), f159: adder(159),
  f160: adder(160), f161: adder(161), f162: adder(162), f163: adder(163), f164: adder(164), f165: adder(165), f166: adder(166), f167: adder(167), f168: adder(168), f169: adder(169),
  f170: adder(170), f171: adder(171), f172: adder(172), f173: adder(173), f174: adder(174), f175: adder(175), f176: adder(176), f177: adder(177), f178: adder(178), f179: adder(179),
  f180: adder(180), f181: adder(181), f182: adder(182), f183: adder(183), f184: adder(184), f185: adder(185), f186: adder(186), f187: adder(187), f188: adder(188), f189: adder(189),
  f190: adder(190), f191: adder(191), f192: adder(192), f193: adder(193), f194: adder(194), f195: adder(195), f196: adder(196), f197: adder(197), f198: adder(198), f199: adder(199),
  f200: adder(200), f201: adder(201), f202: adder(202), f203: adder(203), f204: adder(204), f205: adder(205), f206: adder(206), f207: adder(207), f208: adder(208), f209: adder(209),
  f210: adder(210), f211: adder(211), f212: adder(212), f213: adder(213), f214: adder(214), f215: adder(215), f216: adder(216), f217: adder(217), f218: adder(218), f219: adder(219),
  f220: adder(220), f221: adder(221), f222: adder(222), f223: adder(223), f224: adder(224), f225: adder(225), f226: adder(226), f227: adder(227), f228: adder(228), f229: adder(229),
  f230: adder(230), f231: adder(231), f232: adder(232), f233: adder(233), f234: adder(234), f235: adder(235), f236: adder(236), f237: adder(237), f238: adder(238), f239: adder(239),
  f240: adder(240), f241: adder(241), f242: adder(242), f243: adder(243), f244: adder(244), f245: adder(245), f246: adder(246), f247: adder(247), f248: adder(248), f249: adder(249),
  f250: adder(250), f251: adder(251), f252: adder(252), f253: adder(253), f254: adder(254), f255: adder(255), f256: adder(256), f257: adder(257), f258: adder(258), f259: adder(259),
  f260: adder(260), f261: adder(261), f262: adder(262), f263: adder(263), f264: adder(264), f265: adder(265), f266: adder(266), f267: adder(267), f268: adder(268), f269: adder(269),
  f270: adder(270), f271: adder(271), f272: adder(272), f273: adder(273), f274: adder(274), f275: adder(275), f276: adder(276), f277: adder(277), f278: adder(278), f279: adder(279),
  f280: adder(280), f281: adder(281), f282: adder(282), f283: adder(283), f284: adder(284), f285: adder(285), f286: adder(286), f287: adder(287), f288: adder(288), f289: adder(289),
  f290: adder(290), f291: adder(291), f292: adder(292), f293: adder(293), f294: adder(294), f295: adder(295), f296: adder(296), f297: adder(297), f298: adder(298), f299: adder(299),
});
const makeAccessors = seed => {
  const o = { kept: seed };
  for (let i = 0; i < 300; i++) Object.defineProperty(o, "g" + i, { get() { return this.kept + i; }, set(v) { this.kept = v - i; }, enumerable: true, configurable: true });
  return o;
};
function readValues(o) { return o.p0 + o.p3 * 2 + o.p90 * 3 + o.p129 * 5 + o.p130 * 7 + o.p131 * 11 + o.p132 * 13 + o.p200 * 17 + o.p255 * 19 + o.p256 * 23 + o.p257 * 29 + o.p399 * 31; }
function storeValues(o, v) { o.p2 = v; o.p128 = v + 1; o.p131 = v + 2; o.p200 = v + 3; o.p256 = v + 4; o.p399 = v + 5; }
function callTools(o, x) { return o.f0(x) + o.f100(x) * 2 + o.f126(x) * 3 + o.f127(x) * 5 + o.f128(x) * 7 + o.f135(x) * 11 + o.f250(x) * 13 + o.f299(x) * 17; }
function readTools(o) { return (typeof o.f1 === "function" ? 1 : 0) + (typeof o.f140 === "function" ? 2 : 0) + (typeof o.f298 === "function" ? 4 : 0) + (o.f300 === undefined ? 8 : 0); }
function readAccessors(o) { return o.g0 + o.g60 * 2 + o.g125 * 3 + o.g126 * 5 + o.g127 * 7 + o.g128 * 11 + o.g129 * 13 + o.g200 * 17 + o.g299 * 19; }
function storeAccessors(o, v) { o.g1 = v; const first = o.kept; o.g128 = v; const second = o.kept; o.g299 = v; return first * 3 + second * 5 + o.kept; }
const values = [makeValues(1), makeValues(1000)];
const tools = [makeTools(1), makeTools(50)];
const accessors = [makeAccessors(2), makeAccessors(70)];
let sum = 0;
const mix = n => { sum = Math.imul(sum, 31) + n | 0; };
const round = (i, withSetters = true) => {
  for (const o of values) { mix(readValues(o)); storeValues(o, i); mix(readValues(o)); }
  for (const o of tools) { mix(callTools(o, i)); mix(readTools(o)); }
  for (const o of accessors) { mix(readAccessors(o)); if (withSetters) mix(storeAccessors(o, i)); mix(readAccessors(o)); }
};
round(1);
console.log("the first round:", sum, values[0].p399, values[1].p130, tools[1].f299(1), accessors[0].g299, accessors[1].kept);
for (let i = 0; i < 30; i++) round(i);
let before = visits();
for (let i = 0; i < 300; i++) round(i, false);
console.log("300 rounds:", sum, "the run time is asked at most fifty times:", typeof aotOperationCount !== "function" || visits() - before <= 50);

const hidden = makeValues(5);
Object.defineProperty(hidden, "quiet", { value: 1, writable: true, enumerable: false, configurable: true });
Object.defineProperty(hidden, "fixed", { value: 2, writable: false, enumerable: true, configurable: true });
function bump(o, by) { const was = o.quiet; o.quiet = was + by; return was * 3 + o.quiet + o.fixed + o.p398; }
for (let i = 0; i < 30; i++) mix(bump(hidden, i));
before = visits();
for (let i = 0; i < 300; i++) mix(bump(hidden, i));
console.log("a property far out of line that is not enumerable:", sum, hidden.quiet, Object.keys(hidden).length, "asked at most fifty times:", typeof aotOperationCount !== "function" || visits() - before <= 50);
let refused = "";
try { (o => { o.fixed = 3; })(hidden); } catch (error) { refused = error instanceof TypeError ? "a TypeError" : String(error); }
console.log("a store to one that is read-only:", refused, hidden.fixed);

const parent = makeValues(9);
const child = Object.create(parent);
child.p131 = -1;
mix(readValues(child)); mix(readValues(child)); mix(readValues(parent));
parent.p399 = 77; parent.p131 = 78;
mix(readValues(child)); mix(readValues(parent));
delete values[0].p200;
Object.defineProperty(values[1], "p256", { get() { return -256; }, configurable: true });
Object.defineProperty(accessors[0], "g128", { value: 4, writable: true, configurable: true });
tools[0].f250 = function (x) { return -x; };
delete tools[1].f135;
let thrown = "";
try { round(7); } catch (error) { thrown = error instanceof TypeError ? "a TypeError" : String(error); }
console.log("after changes:", sum, thrown, readValues(values[0]), readValues(values[1]), readAccessors(accessors[0]), callTools(tools[0], 2), child.p399, child.p131);
