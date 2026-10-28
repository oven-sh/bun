// Seed 1482 of fuzz/values-that-end-before-a-suspension-beside-values-that-cross-it.ts: a collection runs while the function waits, between the last read of a value that crossed an earlier await and the allocation of an object that is dropped before a loop of collections and waits.
const lines = [];
function show(value) {
  if (typeof value === "function") return "function>" + show(value());
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (value instanceof Box) return "Box(" + show(value.held) + "," + show(value.extra) + ")";
  if (value instanceof Error) return "Error(" + value.message + ")";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .map(key => key + ":" + show(value[key]))
        .join(",") +
      "}"
    );
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(label, ...values) {
  lines.push(label + ": " + values.map(show).join(" "));
}
function mix(...values) {
  let sum = 7;
  for (const value of values) for (const unit of show(value)) sum = (sum * 31 + unit.charCodeAt(0)) | 0;
  return sum;
}
class Box {
  constructor(held, extra) {
    this.held = held;
    this.extra = extra;
  }
}
const passers = [value => value, value => value];
let passes = 0;
function pass(value) {
  return passers[passes++ & 1](value);
}
function churn(count) {
  const kept = [];
  for (let index = 0; index < count; index++) kept.push({ index, text: "c" + index, list: [index] });
  return kept.length;
}
function descend(depth, number, text) {
  const pair = { number, text };
  return depth === 0 ? show(pair).length : descend(depth - 1, number + 1, text) + (pair.number & 1);
}
function disturb() {
  Bun.gc(true);
}
async function answerLater(value) {
  await null;
  return value;
}
async function failLater(value) {
  await null;
  throw new Error("failed " + value);
}
function* countUp(value) {
  const got = yield value;
  yield mix(got, value);
  return value + 1;
}
const registry = new FinalizationRegistry(markCollected => markCollected());
function readName(value) {
  return value.name.length;
}

function act(iterator, action, step) {
  if (action === "throw") return iterator.throw(new Error("thrown in at " + step));
  if (action === "return") return iterator.return("returned at " + step);
  return iterator.next(step);
}
function actionAt(script, step) {
  return script[Math.min(step, script.length - 1)];
}
function driveGenerators(label, iterators, script) {
  const steps = iterators.map(() => 0);
  const isDone = iterators.map(() => false);
  for (let round = 0; round < 3000 && isDone.includes(false); round++) {
    const at = round % iterators.length;
    if (isDone[at]) continue;
    try {
      const result = act(iterators[at], actionAt(script, steps[at]), steps[at]);
      note(label + " " + at, steps[at], result.value, result.done);
      isDone[at] = result.done;
    } catch (error) {
      note(label + " " + at + " threw", steps[at], error);
      isDone[at] = true;
    }
    steps[at]++;
    disturb();
  }
}
async function driveAsyncGenerators(label, iterators, script) {
  await Promise.all(
    iterators.map(async (iterator, at) => {
      for (let step = 0; step < 3000; step++) {
        try {
          const result = await act(iterator, actionAt(script, step), step);
          note(label + " " + at, step, result.value, result.done);
          if (result.done) return;
        } catch (error) {
          note(label + " " + at + " threw", step, error);
          return;
        }
        disturb();
      }
    }),
  );
}
async function walkAsyncGenerator(label, iterator, last) {
  let step = 0;
  try {
    for await (const value of iterator) {
      note(label, step, value);
      if (step++ === last) break;
    }
  } catch (error) {
    note(label + " threw", step, error);
  }
}
async function driveAsyncFunctions(label, promises) {
  for (const result of await Promise.allSettled(promises))
    note(label, result.status, result.status === "fulfilled" ? result.value : result.reason);
}

const coroutine0 = async (first, second, depth) => {
  let sum = mix(first, depth);
  let kept9, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1;
  {
    const ending0 = pass(null);
    const ending1 = pass(undefined);
    const ending2 = { first: pass(3), second: "t3" };
    const ending3 = pass(undefined);
    const ending4 = Symbol.for("y" + pass(5));
    const ending5 = Symbol.for("y" + pass(6));
    const ending6 = pass(null);
    const ending7 = pass(undefined);
    sum = mix(sum, ending7);
    sum = mix(sum, ending6);
    sum = mix(sum, ending5);
    sum = mix(sum, ending4);
    sum = mix(sum, ending3);
    sum = mix(sum, ending2);
    sum = mix(sum, ending1);
    sum = mix(sum, ending0);
  }
  sum = mix(sum, [kept4, await Promise.resolve(pass(9)), kept6]);
  note("behind 37", kept5, kept8, kept2, sum);
  kept5 = pass(0) / 0;
  kept4 = pass(39.5) * 1.25;
  {
    const ending0 = { first: pass(40), second: "t40" };
    const ending1 = [pass(41), 41.5, "u"];
    const ending2 = BigInt(pass(42)) * 3n;
    const ending3 = pass(-0);
    const ending4 = { first: pass(44), second: "t44" };
    const ending5 = pass(45.5) * 1.25;
    const ending6 = () => pass(46) + 1;
    const ending7 = pass(null);
    const ending8 = BigInt(pass(48)) * 3n;
    const ending9 = pass(-0);
    const ending10 = { first: pass(50), second: "t50" };
    const ending11 = pass(51.5) * 1.25;
    const ending12 = (pass(52) | 0) + 3;
    const ending13 = new Box(pass(53), 53);
    const ending14 = { first: pass(54), second: "t54" };
    const ending15 = "s" + pass(55);
    const ending16 = pass(56) > 55;
    const ending17 = (pass(57) | 0) + 1;
    const ending18 = pass(58.5) * 1.25;
    const ending19 = pass(59) > 58;
    const ending20 = new Box(pass(60), 60);
    const ending21 = Symbol.for("y" + pass(61));
    const ending22 = pass(0) / 0;
    const ending23 = () => pass(63) + 3;
    const ending24 = "s" + pass(64);
    const ending25 = (pass(65) | 0) + 2;
    const ending26 = pass(66.5) * 1.25;
    const ending27 = { first: pass(67), second: "t67" };
    const ending28 = pass(0) / 0;
    const ending29 = Symbol.for("y" + pass(69));
    const ending30 = "s" + pass(70);
    const ending31 = Symbol.for("y" + pass(71));
    const ending32 = BigInt(pass(72)) * 3n;
    const ending33 = Symbol.for("y" + pass(73));
    const ending34 = pass(undefined);
    const ending35 = pass(75.5) * 1.25;
    const ending36 = pass(undefined);
    const ending37 = new Box(pass(77), 77);
    const ending38 = new Box(pass(78), 78);
    const ending39 = pass(79.5) * 1.25;
    const ending40 = [pass(80), 80.5, "u"];
    const ending41 = pass(81) > 82;
    const ending42 = pass(82) > 81;
    const ending43 = new Box(pass(83), 83);
    const ending44 = () => pass(84) + 4;
    const ending45 = pass(85) > 84;
    const ending46 = () => pass(86) + 1;
    const ending47 = (pass(87) | 0) + 3;
    const ending48 = Symbol.for("y" + pass(88));
    const ending49 = pass(89.5) * 1.25;
    const ending50 = pass(0) / 0;
    const ending51 = (pass(91) | 0) + 0;
    const ending52 = pass(0) / 0;
    const ending53 = new Box(pass(93), 93);
    const ending54 = "s" + pass(94);
    const ending55 = [pass(95), 95.5, "u"];
    const ending56 = BigInt(pass(96)) * 3n;
    const ending57 = BigInt(pass(97)) * 3n;
    const ending58 = pass(0) / 0;
    const ending59 = pass(null);
    const ending60 = pass(100) > 99;
    const ending61 = BigInt(pass(101)) * 3n;
    const ending62 = pass(102.5) * 1.25;
    const ending63 = [pass(103), 103.5, "u"];
    const ending64 = [pass(104), 104.5, "u"];
    const ending65 = BigInt(pass(105)) * 3n;
    const ending66 = [pass(106), 106.5, "u"];
    const ending67 = pass(107) > 106;
    const ending68 = "s" + pass(108);
    const ending69 = pass(109.5) * 1.25;
    const ending70 = "s" + pass(110);
    const ending71 = [pass(111), 111.5, "u"];
    const ending72 = new Box(pass(112), 112);
    const ending73 = pass(-0);
    const ending74 = (pass(114) | 0) + 2;
    const ending75 = BigInt(pass(115)) * 3n;
    const ending76 = [pass(116), 116.5, "u"];
    const ending77 = pass(-0);
    const ending78 = new Box(pass(118), 118);
    const ending79 = { first: pass(119), second: "t119" };
    const ending80 = "s" + pass(120);
    const ending81 = (pass(121) | 0) + 2;
    const ending82 = (pass(122) | 0) + 3;
    const ending83 = pass(123.5) * 1.25;
    const ending84 = pass(124) > 123;
    const ending85 = pass(125.5) * 1.25;
    const ending86 = new Box(pass(126), 126);
    const ending87 = new Box(pass(127), 127);
    const ending88 = pass(128.5) * 1.25;
    const ending89 = (pass(129) | 0) + 3;
    const ending90 = Symbol.for("y" + pass(130));
    const ending91 = pass(131.5) * 1.25;
    const ending92 = pass(132) > 133;
    const ending93 = new Box(pass(133), 133);
    const ending94 = BigInt(pass(134)) * 3n;
    const ending95 = () => pass(135) + 0;
    const ending96 = { first: pass(136), second: "t136" };
    const ending97 = pass(137) > 136;
    const ending98 = new Box(pass(138), 138);
    const ending99 = [pass(139), 139.5, "u"];
    const ending100 = "s" + pass(140);
    const ending101 = [pass(141), 141.5, "u"];
    const ending102 = { first: pass(142), second: "t142" };
    const ending103 = pass(143) > 142;
    const ending104 = "s" + pass(144);
    const ending105 = pass(145.5) * 1.25;
    const ending106 = pass(146) > 145;
    const ending107 = () => pass(147) + 2;
    const ending108 = (pass(148) | 0) + 1;
    const ending109 = BigInt(pass(149)) * 3n;
    const ending110 = Symbol.for("y" + pass(150));
    const ending111 = (pass(151) | 0) + 4;
    const ending112 = pass(152.5) * 1.25;
    const ending113 = pass(-0);
    const ending114 = pass(0) / 0;
    const ending115 = new Box(pass(155), 155);
    const ending116 = () => pass(156) + 1;
    const ending117 = pass(157.5) * 1.25;
    const ending118 = () => pass(158) + 3;
    const ending119 = pass(null);
    const ending120 = new Box(pass(160), 160);
    const ending121 = pass(161.5) * 1.25;
    const ending122 = () => pass(162) + 2;
    const ending123 = pass(163.5) * 1.25;
    const ending124 = BigInt(pass(164)) * 3n;
    const ending125 = [pass(165), 165.5, "u"];
    const ending126 = pass(undefined);
    const ending127 = { first: pass(167), second: "t167" };
    const ending128 = (pass(168) | 0) + 0;
    const ending129 = () => pass(169) + 4;
    const ending130 = (pass(170) | 0) + 2;
    sum = mix(
      sum,
      ending0,
      ending1,
      ending2,
      ending3,
      ending4,
      ending5,
      ending6,
      ending7,
      ending8,
      ending9,
      ending10,
      ending11,
      ending12,
      ending13,
      ending14,
      ending15,
      ending16,
      ending17,
      ending18,
      ending19,
      ending20,
      ending21,
      ending22,
      ending23,
      ending24,
      ending25,
      ending26,
      ending27,
      ending28,
      ending29,
      ending30,
      ending31,
      ending32,
      ending33,
      ending34,
      ending35,
      ending36,
      ending37,
      ending38,
      ending39,
      ending40,
      ending41,
      ending42,
      ending43,
      ending44,
      ending45,
      ending46,
      ending47,
      ending48,
      ending49,
      ending50,
      ending51,
      ending52,
      ending53,
      ending54,
      ending55,
      ending56,
      ending57,
      ending58,
      ending59,
      ending60,
      ending61,
      ending62,
      ending63,
      ending64,
      ending65,
      ending66,
      ending67,
      ending68,
      ending69,
      ending70,
      ending71,
      ending72,
      ending73,
      ending74,
      ending75,
      ending76,
      ending77,
      ending78,
      ending79,
      ending80,
      ending81,
      ending82,
      ending83,
      ending84,
      ending85,
      ending86,
      ending87,
      ending88,
      ending89,
      ending90,
      ending91,
      ending92,
      ending93,
      ending94,
      ending95,
      ending96,
      ending97,
      ending98,
      ending99,
      ending100,
      ending101,
      ending102,
      ending103,
      ending104,
      ending105,
      ending106,
      ending107,
      ending108,
      ending109,
      ending110,
      ending111,
      ending112,
      ending113,
      ending114,
      ending115,
      ending116,
      ending117,
      ending118,
      ending119,
      ending120,
      ending121,
      ending122,
      ending123,
      ending124,
      ending125,
      ending126,
      ending127,
      ending128,
      ending129,
      ending130,
    );
  }
  sum = mix(sum, Array.of(kept4, await answerLater(171), kept7, await answerLater(172), kept4));
  {
    const ending0 = pass(0) / 0;
    const ending1 = Symbol.for("y" + pass(199));
    const ending2 = { first: pass(200), second: "t200" };
    const ending3 = BigInt(pass(201)) * 3n;
    const ending4 = pass(202) > 201;
    const ending5 = pass(203) > 202;
    const ending6 = new Box(pass(204), 204);
    const ending7 = BigInt(pass(205)) * 3n;
    const ending8 = () => pass(206) + 1;
    const ending9 = pass(-0);
    const ending10 = Symbol.for("y" + pass(208));
    const ending11 = "s" + pass(209);
    const ending12 = "s" + pass(210);
    const ending13 = () => pass(211) + 1;
    const ending14 = { first: pass(212), second: "t212" };
    const ending15 = new Box(pass(213), 213);
    const ending16 = Symbol.for("y" + pass(214));
    const ending17 = new Box(pass(215), 215);
    const ending18 = pass(undefined);
    const ending19 = "s" + pass(217);
    const ending20 = [pass(218), 218.5, "u"];
    const ending21 = pass(219) > 220;
    const ending22 = () => pass(220) + 0;
    const ending23 = BigInt(pass(221)) * 3n;
    const ending24 = [pass(222), 222.5, "u"];
    const ending25 = BigInt(pass(223)) * 3n;
    const ending26 = pass(undefined);
    const ending27 = Symbol.for("y" + pass(225));
    const ending28 = pass(0) / 0;
    const ending29 = BigInt(pass(227)) * 3n;
    const ending30 = (pass(228) | 0) + 4;
    const ending31 = new Box(pass(229), 229);
    sum = mix(
      sum,
      Array.of(
        ending0,
        ending1,
        ending2,
        ending3,
        ending4,
        ending5,
        ending6,
        ending7,
        ending8,
        ending9,
        ending10,
        ending11,
        ending12,
        ending13,
        ending14,
        ending15,
        ending16,
        ending17,
        ending18,
        ending19,
        ending20,
        ending21,
        ending22,
        ending23,
        ending24,
        ending25,
        ending26,
        ending27,
        ending28,
        ending29,
        ending30,
        ending31,
      ),
    );
  }
  sum = mix(sum, Array.of(kept8, await Bun.sleep(0), kept5, await Promise.resolve(pass(231)), kept8));
  note("behind 235", kept3, sum);
  try {
    try {
      {
        const ending0 = "s" + pass(236);
        const ending1 = "s" + pass(237);
        const ending2 = "s" + pass(238);
        sum = mix(sum, Array.of(ending0, ending1, ending2));
      }
      sum = mix(sum, [kept2, await Promise.all([pass(239), Promise.resolve(240)]), kept9]);
      note("behind 266", kept3, kept6, kept9, second, sum);
      kept2 = pass(-0);
      kept6 = pass(268) > 267;
      {
        const ending0 = Symbol.for("y" + pass(269));
        const ending1 = [pass(270), 270.5, "u"];
        const ending2 = "s" + pass(271);
        const ending3 = pass(undefined);
        const ending4 = (pass(273) | 0) + 0;
        const ending5 = Symbol.for("y" + pass(274));
        const ending6 = pass(null);
        const ending7 = () => pass(276) + 1;
        const ending8 = BigInt(pass(277)) * 3n;
        const ending9 = Symbol.for("y" + pass(278));
        const ending10 = BigInt(pass(279)) * 3n;
        const ending11 = (pass(280) | 0) + 0;
        const ending12 = "s" + pass(281);
        sum = mix(
          sum,
          Array.of(
            ending0,
            ending1,
            ending2,
            ending3,
            ending4,
            ending5,
            ending6,
            ending7,
            ending8,
            ending9,
            ending10,
            ending11,
            ending12,
          ),
        );
      }
      sum = mix(sum, Array.of(pass(284) > 283, Symbol.for("y" + pass(285)), await null, kept9));
      churn(50);
      note("behind 287", kept7, kept9, sum);
      kept1 = { first: pass(288), second: "t288" };
      kept2 = BigInt(pass(289)) * 3n;
      {
        const ending0 = pass(undefined);
        const ending1 = "s" + pass(291);
        const ending2 = pass(292.5) * 1.25;
        const ending3 = pass(293.5) * 1.25;
        const ending4 = () => pass(294) + 4;
        const ending5 = (pass(295) | 0) + 1;
        const ending6 = pass(0) / 0;
        const ending7 = (pass(297) | 0) + 3;
        const ending8 = pass(undefined);
        const ending9 = pass(299) > 298;
        const ending10 = pass(300.5) * 1.25;
        const ending11 = "s" + pass(301);
        const ending12 = [pass(302), 302.5, "u"];
        const ending13 = (pass(303) | 0) + 2;
        const ending14 = pass(304) > 303;
        const ending15 = pass(305) > 304;
        const ending16 = "s" + pass(306);
        const ending17 = { first: pass(307), second: "t307" };
        const ending18 = BigInt(pass(308)) * 3n;
        const ending19 = { first: pass(309), second: "t309" };
        const ending20 = BigInt(pass(310)) * 3n;
        const ending21 = Symbol.for("y" + pass(311));
        const ending22 = [pass(312), 312.5, "u"];
        const ending23 = pass(313) > 312;
        const list = [];
        list.push(
          ending0,
          ending1,
          ending2,
          ending3,
          ending4,
          ending5,
          ending6,
          ending7,
          ending8,
          ending9,
          ending10,
          ending11,
          ending12,
          ending13,
          ending14,
          ending15,
          ending16,
          ending17,
          ending18,
          ending19,
          ending20,
          ending21,
          ending22,
          ending23,
        );
        sum = mix(sum, list.splice(0));
      }
      note("before 314", kept4, kept8, sum);
      sum = mix(sum, await Bun.sleep(0));
      disturb();
      note("behind 337", first, kept8, kept2, sum);
      {
        const ending0 = pass(338.5) * 1.25;
        const ending1 = pass(-0);
        const ending2 = pass(0) / 0;
        sum = mix(sum, ending0 + ending1 + ending2);
      }
      note("before 341", kept1, first, sum);
      sum = mix(
        sum,
        Array.of(
          pass(344.5) * 1.25,
          Symbol.for("y" + pass(345)),
          { first: pass(346), second: "t346" },
          { first: pass(347), second: "t347" },
          pass(348) > 349,
          pass(-0),
          pass(350) > 349,
          { first: pass(351), second: "t351" },
          "s" + pass(352),
          "s" + pass(353),
          pass(0) / 0,
          (pass(355) | 0) + 5,
          pass(0) / 0,
          () => pass(357) + 2,
          Symbol.for("y" + pass(358)),
          { first: pass(359), second: "t359" },
          "s" + pass(360),
          { first: pass(361), second: "t361" },
          { first: pass(362), second: "t362" },
          BigInt(pass(363)) * 3n,
          (pass(364) | 0) + 0,
          pass(null),
          () => pass(366) + 1,
          (pass(367) | 0) + 3,
          pass(368) > 367,
          [pass(369), 369.5, "u"],
          (pass(370) | 0) + 6,
          BigInt(pass(371)) * 3n,
          await new Promise(resolve => setTimeout(resolve, 0, 342)),
          first,
        ),
      );
      note("behind 373", first, kept2, kept5, kept9, kept6, kept1, kept7, kept4, kept3, kept8, sum);
      for await (const item of [pass(381), Promise.resolve(kept9)]) sum = mix(sum, item, kept2);
      note("behind 382", kept1, kept3, kept6, kept9, sum);
    } catch (error) {
      note("caught 383", error);
      note("in the catch 384", kept8, kept4, sum);
    } finally {
      note("in the finally 385", first, kept6, kept1, sum);
      {
        const ending0 = Symbol.for("y" + pass(386));
        const ending1 = pass(387.5) * 1.25;
        const ending2 = pass(0) / 0;
        const ending3 = () => pass(389) + 4;
        const ending4 = pass(undefined);
        const ending5 = pass(391) > 390;
        const ending6 = "s" + pass(392);
        const ending7 = pass(null);
        const ending8 = (pass(394) | 0) + 2;
        const ending9 = pass(395) > 394;
        const ending10 = [pass(396), 396.5, "u"];
        const ending11 = Symbol.for("y" + pass(397));
        const ending12 = "s" + pass(398);
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
      sum = mix(
        sum,
        show(kept7) +
          show(
            await {
              then(resolve) {
                disturb();
                resolve(399);
              },
            },
          ) +
          show(first),
      );
    }
    kept4 = new Box(pass(406), 406);
    {
      const ending0 = (pass(407) | 0) + 1;
      sum = mix(sum, ending0);
    }
    sum = mix(sum, show(kept5) + show(await Bun.sleep(0)) + show(kept2));
  } catch (error) {
    note("caught 426", error);
    note("in the catch 427", kept4, sum);
  } finally {
    note("in the finally 428", kept4, kept3, kept8, kept1, sum);
  }
  let isCollected = false;
  {
    const watched = { name: "w" + pass(429) };
    registry.register(watched, () => void (isCollected = true));
    const ending0 = (pass(430) | 0) + 3;
    const ending1 = new Box(pass(431), 431);
    sum = mix(sum, [ending0, ending1]);
    sum = mix(sum, readName(watched), readName(watched), watched);
  }
  for (let round = 0; !isCollected && round < 300; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  note("watched", isCollected ? "collected" : "still held");
  note("end", first, second, kept9, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1, sum);
  return sum;
};
const holderOfcoroutine1 = {
  *run(first, second, depth) {
    let sum = mix(first, depth);
    let kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1;
    try {
      kept2 = BigInt(pass(1)) * 3n;
      note("before 2", kept6, kept1, sum);
      sum = mix(
        sum,
        Array.of(
          pass(5.5) * 1.25,
          pass(6) > 7,
          pass(7) > 6,
          pass(0) / 0,
          new Box(pass(9), 9),
          pass(undefined),
          "s" + pass(11),
          new Box(pass(12), 12),
          () => pass(13) + 3,
          new Box(pass(14), 14),
          pass(-0),
          (pass(16) | 0) + 2,
          pass(17) > 16,
          pass(18) > 19,
          [pass(19), 19.5, "u"],
          { first: pass(20), second: "t20" },
          pass(-0),
          pass(22) > 21,
          pass(23) > 22,
          pass(undefined),
          yield* [3, 4],
          kept7,
        ),
      );
      Bun.gc(true);
      try {
        {
          const ending0 = BigInt(pass(25)) * 3n;
          sum = mix(sum, ending0);
        }
        sum = mix(sum, show(second) + show(yield* countUp(26)) + show(kept7));
        note("behind 42", kept6, kept8, kept7, sum);
        kept4 = BigInt(pass(43)) * 3n;
        kept6 = { first: pass(44), second: "t44" };
        kept7 = new Box(pass(45), 45);
        kept1 = () => pass(46) + 1;
        note("before 47", kept7, kept3, sum);
        sum = mix(
          sum,
          Array.of(
            pass(undefined),
            { first: pass(51), second: "t51" },
            BigInt(pass(52)) * 3n,
            () => pass(53) + 3,
            { first: pass(54), second: "t54" },
            { first: pass(55), second: "t55" },
            [pass(56), 56.5, "u"],
            BigInt(pass(57)) * 3n,
            BigInt(pass(58)) * 3n,
            Symbol.for("y" + pass(59)),
            "s" + pass(60),
            (pass(61) | 0) + 5,
            yield 48,
            kept8,
          ),
        );
        disturb();
        note("behind 62", kept1, sum);
        {
          const ending0 = [pass(63), 63.5, "u"];
          sum = mix(sum, [ending0]);
        }
        note("before 64", kept7, kept4, kept8, sum);
        sum = mix(kept4, yield pass(65), kept8);
        {
          const ending0 = Symbol.for("y" + pass(69));
          sum = mix(sum, Array.of(ending0));
        }
        sum = mix(kept4, yield pass(70), kept6);
        note("behind 92", kept2, kept6, kept8, sum);
      } catch (error) {
        note("caught 93", error);
        note("in the catch 94", kept7, sum);
        {
          const ending0 = pass(95) > 94;
          const ending1 = new Box(pass(96), 96);
          const ending2 = pass(-0);
          const ending3 = Symbol.for("y" + pass(98));
          const ending4 = Symbol.for("y" + pass(99));
          const ending5 = pass(0) / 0;
          const ending6 = pass(101.5) * 1.25;
          const ending7 = [pass(102), 102.5, "u"];
          const ending8 = "s" + pass(103);
          const ending9 = pass(0) / 0;
          const ending10 = (pass(105) | 0) + 0;
          const ending11 = BigInt(pass(106)) * 3n;
          const ending12 = [pass(107), 107.5, "u"];
          sum = mix(
            sum,
            ending0,
            ending1,
            ending2,
            ending3,
            ending4,
            ending5,
            ending6,
            ending7,
            ending8,
            ending9,
            ending10,
            ending11,
            ending12,
          );
        }
        sum = mix(kept7, yield pass(108), kept6);
        note("behind 121", second, kept6, kept8, sum);
      }
      kept2 = BigInt(pass(122)) * 3n;
      kept8 = () => pass(123) + 3;
      sum = mix(sum, Array.of(kept2, yield 124, kept7, yield* [125, 126], kept2));
      note("behind 141", second, kept3, sum);
      for (let turn142 = 0; turn142 < 3; turn142++) {
        sum = mix(kept5, yield 143, kept2);
        if (turn142 === 1) note("one turn 165", kept5, kept3, kept1, kept4, kept7, sum);
        sum = mix(sum, turn142);
      }
    } catch (error) {
      note("caught 166", error);
      note("in the catch 167", kept3, kept8, kept5, second, sum);
    } finally {
      note("in the finally 168", kept8, sum);
    }
    kept1 = pass(169) > 168;
    kept2 = pass(170) > 169;
    {
      const ending0 = "s" + pass(171);
      const ending1 = pass(0) / 0;
      const ending2 = Symbol.for("y" + pass(173));
      const ending3 = Symbol.for("y" + pass(174));
      const ending4 = [pass(175), 175.5, "u"];
      const ending5 = [pass(176), 176.5, "u"];
      const ending6 = (pass(177) | 0) + 2;
      const ending7 = "s" + pass(178);
      const ending8 = (pass(179) | 0) + 4;
      const ending9 = pass(0) / 0;
      const ending10 = BigInt(pass(181)) * 3n;
      const ending11 = (pass(182) | 0) + 0;
      const ending12 = pass(183.5) * 1.25;
      sum = mix(sum, [
        ending0,
        ending1,
        ending2,
        ending3,
        ending4,
        ending5,
        ending6,
        ending7,
        ending8,
        ending9,
        ending10,
        ending11,
        ending12,
      ]);
    }
    sum = mix(kept7, yield pass(184), kept5);
    churn(50);
    note("behind 205", kept4, kept3, kept8, first, kept7, kept5, kept2, kept1, second, kept6, sum);
    note("end", first, second, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1, sum);
    return sum;
  },
};
function* coroutine2(first, second, depth) {
  let sum = mix(first, depth);
  let kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1;
  {
    const ending0 = [pass(1), 1.5, "u"];
    const ending1 = Symbol.for("y" + pass(2));
    const ending2 = () => pass(3) + 3;
    const ending3 = Symbol.for("y" + pass(4));
    const ending4 = [pass(5), 5.5, "u"];
    const ending5 = Symbol.for("y" + pass(6));
    const ending6 = pass(-0);
    const ending7 = pass(0) / 0;
    const ending8 = new Box(pass(9), 9);
    const ending9 = pass(10.5) * 1.25;
    const ending10 = BigInt(pass(11)) * 3n;
    const ending11 = new Box(pass(12), 12);
    const ending12 = () => pass(13) + 3;
    const list = [];
    list.push(
      ending0,
      ending1,
      ending2,
      ending3,
      ending4,
      ending5,
      ending6,
      ending7,
      ending8,
      ending9,
      ending10,
      ending11,
      ending12,
    );
    sum = mix(sum, list.splice(0));
  }
  sum = mix(sum, depth > 0 ? yield* coroutine2(kept2, second, depth - 1) : yield mix(sum, 14));
  note("behind 15", kept2, sum);
  note("end", first, second, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1, sum);
  return sum;
}
async function main() {
  await driveAsyncFunctions("async arrow 0", [coroutine0(new Box(1, 2), [1, 2], 0)]);
  driveGenerators(
    "generator method 1",
    [holderOfcoroutine1.run(null, 7n, 0), holderOfcoroutine1.run(1, "a", 0)],
    ["next", "next", "next", "next", "next", "next", "next", "next", "next"],
  );
  driveGenerators(
    "generator 2",
    [coroutine2({ first: 1 }, null, 120), coroutine2("a", 7n, 120), coroutine2([1, 2], 7n, 120)],
    ["next", "next", "next", "next", "next", "next", "next", "throw", "next"],
  );
}
function print() {
  note("registry", typeof registry.register);
  console.log(lines.slice(0, 600).join("\n"));
  console.log(lines.length, mix(lines));
}
main().then(print, error => {
  note("main failed", error);
  print();
});
