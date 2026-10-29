// Seed 2409 of fuzz/values-that-end-before-a-suspension-beside-values-that-cross-it.ts, with an object that is last read before a loop of collections and waits; the coroutine waits for a timer before it makes the object, as the loop does.
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
  let kept5, kept4, kept3, kept2, kept1;
  try {
    {
      const ending0 = pass(1.5) * 1.25;
      const ending1 = pass(undefined);
      const ending2 = new Box(pass(3), 3);
      const ending3 = pass(4) > 3;
      const ending4 = [pass(5), 5.5, "u"];
      const ending5 = pass(0) / 0;
      const ending6 = pass(-0);
      const ending7 = (pass(8) | 0) + 1;
      const ending8 = pass(9.5) * 1.25;
      const ending9 = Symbol.for("y" + pass(10));
      const ending10 = BigInt(pass(11)) * 3n;
      const ending11 = { first: pass(12), second: "t12" };
      const ending12 = { first: pass(13), second: "t13" };
      const ending13 = pass(14.5) * 1.25;
      const ending14 = pass(15) > 16;
      const ending15 = Symbol.for("y" + pass(16));
      const ending16 = [pass(17), 17.5, "u"];
      const ending17 = "s" + pass(18);
      const ending18 = Symbol.for("y" + pass(19));
      const ending19 = (pass(20) | 0) + 6;
      const ending20 = (pass(21) | 0) + 0;
      const ending21 = [pass(22), 22.5, "u"];
      const ending22 = pass(23) > 22;
      const ending23 = pass(24) > 25;
      const ending24 = pass(25) > 24;
      const ending25 = pass(26.5) * 1.25;
      const ending26 = pass(27) > 28;
      const ending27 = new Box(pass(28), 28);
      const ending28 = pass(29) > 28;
      const ending29 = [pass(30), 30.5, "u"];
      const ending30 = BigInt(pass(31)) * 3n;
      const ending31 = Symbol.for("y" + pass(32));
      const ending32 = BigInt(pass(33)) * 3n;
      const ending33 = { first: pass(34), second: "t34" };
      const ending34 = [pass(35), 35.5, "u"];
      const ending35 = BigInt(pass(36)) * 3n;
      const ending36 = Symbol.for("y" + pass(37));
      const ending37 = () => pass(38) + 3;
      const ending38 = "s" + pass(39);
      const ending39 = [pass(40), 40.5, "u"];
      const ending40 = [pass(41), 41.5, "u"];
      const ending41 = [pass(42), 42.5, "u"];
      const ending42 = { first: pass(43), second: "t43" };
      const ending43 = Symbol.for("y" + pass(44));
      const ending44 = [pass(45), 45.5, "u"];
      const ending45 = new Box(pass(46), 46);
      const ending46 = [pass(47), 47.5, "u"];
      const ending47 = pass(undefined);
      const ending48 = pass(-0);
      const ending49 = pass(0) / 0;
      const ending50 = () => pass(51) + 1;
      const ending51 = pass(undefined);
      const ending52 = (pass(53) | 0) + 4;
      const ending53 = "s" + pass(54);
      const ending54 = BigInt(pass(55)) * 3n;
      const ending55 = "s" + pass(56);
      const ending56 = Symbol.for("y" + pass(57));
      const ending57 = { first: pass(58), second: "t58" };
      const ending58 = pass(59.5) * 1.25;
      const ending59 = pass(0) / 0;
      const ending60 = pass(61) > 60;
      const ending61 = Symbol.for("y" + pass(62));
      const ending62 = { first: pass(63), second: "t63" };
      const ending63 = pass(0) / 0;
      const ending64 = pass(null);
      const ending65 = pass(0) / 0;
      const ending66 = "s" + pass(67);
      const ending67 = pass(undefined);
      const ending68 = Symbol.for("y" + pass(69));
      const ending69 = new Box(pass(70), 70);
      const ending70 = [pass(71), 71.5, "u"];
      const ending71 = pass(0) / 0;
      const ending72 = pass(73.5) * 1.25;
      const ending73 = pass(0) / 0;
      const ending74 = new Box(pass(75), 75);
      const ending75 = new Box(pass(76), 76);
      const ending76 = Symbol.for("y" + pass(77));
      const ending77 = () => pass(78) + 3;
      const ending78 = new Box(pass(79), 79);
      const ending79 = Symbol.for("y" + pass(80));
      const ending80 = [pass(81), 81.5, "u"];
      const ending81 = { first: pass(82), second: "t82" };
      const ending82 = pass(null);
      const ending83 = new Box(pass(84), 84);
      const ending84 = () => pass(85) + 0;
      const ending85 = (pass(86) | 0) + 2;
      const ending86 = { first: pass(87), second: "t87" };
      const ending87 = new Box(pass(88), 88);
      const ending88 = { first: pass(89), second: "t89" };
      const ending89 = [pass(90), 90.5, "u"];
      const ending90 = pass(91) > 90;
      const ending91 = pass(0) / 0;
      const ending92 = pass(93) > 94;
      const ending93 = { first: pass(94), second: "t94" };
      const ending94 = new Box(pass(95), 95);
      const ending95 = pass(96.5) * 1.25;
      const ending96 = pass(97) > 96;
      const ending97 = Symbol.for("y" + pass(98));
      const ending98 = BigInt(pass(99)) * 3n;
      const ending99 = [pass(100), 100.5, "u"];
      const ending100 = pass(101) > 100;
      const ending101 = new Box(pass(102), 102);
      const ending102 = Symbol.for("y" + pass(103));
      const ending103 = () => pass(104) + 4;
      const ending104 = pass(-0);
      const ending105 = pass(106.5) * 1.25;
      const ending106 = new Box(pass(107), 107);
      const ending107 = BigInt(pass(108)) * 3n;
      const ending108 = pass(109) > 108;
      const ending109 = BigInt(pass(110)) * 3n;
      const ending110 = pass(-0);
      const ending111 = pass(112.5) * 1.25;
      const ending112 = new Box(pass(113), 113);
      const ending113 = [pass(114), 114.5, "u"];
      const ending114 = pass(115.5) * 1.25;
      const ending115 = Symbol.for("y" + pass(116));
      const ending116 = BigInt(pass(117)) * 3n;
      const ending117 = "s" + pass(118);
      const ending118 = "s" + pass(119);
      const ending119 = BigInt(pass(120)) * 3n;
      const ending120 = [pass(121), 121.5, "u"];
      const ending121 = [pass(122), 122.5, "u"];
      const ending122 = BigInt(pass(123)) * 3n;
      const ending123 = "s" + pass(124);
      const ending124 = pass(null);
      const ending125 = pass(undefined);
      const ending126 = pass(-0);
      const ending127 = new Box(pass(128), 128);
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
      ]);
    }
    sum = mix(sum, show(second) + show(await null) + show(second));
    note("behind 139", first, second, sum);
    kept5 = pass(140.5) * 1.25;
    {
      const ending0 = (pass(141) | 0) + 1;
      const ending1 = pass(0) / 0;
      const ending2 = pass(143.5) * 1.25;
      const ending3 = pass(144.5) * 1.25;
      const ending4 = (pass(145) | 0) + 5;
      const ending5 = pass(0) / 0;
      const ending6 = (pass(147) | 0) + 0;
      const ending7 = pass(0) / 0;
      const ending8 = (pass(149) | 0) + 2;
      const ending9 = pass(150.5) * 1.25;
      const ending10 = (pass(151) | 0) + 4;
      const ending11 = pass(0) / 0;
      const ending12 = (pass(153) | 0) + 6;
      const ending13 = pass(154.5) * 1.25;
      const ending14 = (pass(155) | 0) + 1;
      const ending15 = pass(0) / 0;
      const ending16 = pass(-0);
      const ending17 = (pass(158) | 0) + 4;
      const ending18 = pass(159.5) * 1.25;
      const ending19 = (pass(160) | 0) + 6;
      const ending20 = pass(-0);
      const ending21 = (pass(162) | 0) + 1;
      const ending22 = pass(163.5) * 1.25;
      const ending23 = (pass(164) | 0) + 3;
      sum = mix(sum, ending23);
      sum = mix(sum, ending22);
      sum = mix(sum, ending21);
      sum = mix(sum, ending20);
      sum = mix(sum, ending19);
      sum = mix(sum, ending18);
      sum = mix(sum, ending17);
      sum = mix(sum, ending16);
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
    await {
      then(resolve) {
        disturb();
        resolve(165);
      },
    };
    note("behind 171", second, kept2, kept5, kept4, sum);
    kept5 = pass(172.5) * 1.25;
    sum = mix(
      sum,
      Array.of(
        kept1,
        await {
          then(resolve) {
            disturb();
            resolve(173);
          },
        },
        kept5,
        await answerLater(174),
        kept1,
      ),
    );
    note("behind 203", first, kept3, sum);
    {
      const ending0 = new Box(pass(204), 204);
      sum = mix(sum, Array.of(ending0));
    }
    sum = mix(
      sum,
      Array.of(
        second,
        await answerLater(205),
        kept5,
        await {
          then(resolve) {
            disturb();
            resolve(206);
          },
        },
        second,
      ),
    );
    kept1 = () => pass(229) + 4;
    {
      const ending0 = BigInt(pass(230)) * 3n;
      const ending1 = pass(-0);
      const ending2 = Symbol.for("y" + pass(232));
      const ending3 = Symbol.for("y" + pass(233));
      const ending4 = pass(0) / 0;
      sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4));
    }
    sum = mix(sum, (await answerLater(235)) ? kept4 : kept3);
    note("behind 260", kept5, kept1, sum);
  } finally {
    note("in the finally 261", first, sum);
  }
  note("end", first, second, kept5, kept4, kept3, kept2, kept1, sum);
  return sum;
};
async function coroutine1(first, second, depth) {
  let sum = mix(first, depth);
  let kept6, kept5, kept4, kept3, kept2, kept1;
  try {
    for (let turn1 = 0; turn1 < 4; turn1++) {
      {
        const ending0 = (pass(2) | 0) + 2;
        const ending1 = pass(null);
        const ending2 = { first: pass(4), second: "t4" };
        const ending3 = BigInt(pass(5)) * 3n;
        const ending4 = { first: pass(6), second: "t6" };
        const ending5 = () => pass(7) + 2;
        const ending6 = () => pass(8) + 3;
        const ending7 = "s" + pass(9);
        sum = mix(sum, ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7);
      }
      sum = mix(sum, await null);
      note("behind 26", kept3, second, sum);
      kept6 = pass(null);
      {
        const ending0 = { first: pass(28), second: "t28" };
        const ending1 = () => pass(29) + 4;
        const ending2 = (pass(30) | 0) + 2;
        const ending3 = Symbol.for("y" + pass(31));
        const ending4 = Symbol.for("y" + pass(32));
        const list = [];
        list.push(ending0, ending1, ending2, ending3, ending4);
        sum = mix(sum, list.splice(0));
      }
      sum = mix(sum, Array.of(first, await null, kept2, await Promise.all([pass(34), Promise.resolve(35)]), first));
      note("behind 48", kept1, kept6, first, sum);
      if (turn1 === 1) note("one turn 49", kept6, kept3, first, kept4, kept2, sum);
      sum = mix(sum, turn1);
    }
    kept4 = (pass(50) | 0) + 1;
    {
      const ending0 = pass(null);
      const ending1 = pass(52.5) * 1.25;
      const ending2 = BigInt(pass(53)) * 3n;
      const ending3 = pass(54.5) * 1.25;
      const ending4 = BigInt(pass(55)) * 3n;
      const ending5 = Symbol.for("y" + pass(56));
      const ending6 = pass(-0);
      const ending7 = pass(58) > 57;
      const ending8 = [pass(59), 59.5, "u"];
      const ending9 = Symbol.for("y" + pass(60));
      const ending10 = new Box(pass(61), 61);
      const ending11 = { first: pass(62), second: "t62" };
      const ending12 = { first: pass(63), second: "t63" };
      const ending13 = Symbol.for("y" + pass(64));
      const ending14 = pass(65.5) * 1.25;
      const ending15 = "s" + pass(66);
      const ending16 = pass(-0);
      const ending17 = { first: pass(68), second: "t68" };
      const ending18 = (pass(69) | 0) + 6;
      const ending19 = BigInt(pass(70)) * 3n;
      const ending20 = pass(null);
      const ending21 = pass(undefined);
      const ending22 = () => pass(73) + 3;
      const ending23 = pass(74) > 73;
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
      ]);
    }
    sum = mix(
      sum,
      show(first) +
        show(
          await {
            then(resolve) {
              disturb();
              resolve(75);
            },
          },
        ) +
        show(kept2),
    );
    churn(50);
    kept6 = (pass(85) | 0) + 1;
    kept5 = (pass(86) | 0) + 2;
    kept4 = pass(87.5) * 1.25;
    {
      const ending0 = pass(88.5) * 1.25;
      const ending1 = pass(89.5) * 1.25;
      const ending2 = pass(0) / 0;
      const ending3 = pass(-0);
      const ending4 = pass(92.5) * 1.25;
      const ending5 = pass(-0);
      const ending6 = (pass(94) | 0) + 3;
      const ending7 = pass(-0);
      const ending8 = pass(0) / 0;
      const ending9 = (pass(97) | 0) + 6;
      const ending10 = pass(98.5) * 1.25;
      const ending11 = (pass(99) | 0) + 1;
      const ending12 = (pass(100) | 0) + 2;
      const ending13 = pass(101.5) * 1.25;
      const ending14 = pass(0) / 0;
      const ending15 = pass(103.5) * 1.25;
      const ending16 = (pass(104) | 0) + 6;
      const ending17 = pass(-0);
      const ending18 = pass(106.5) * 1.25;
      const ending19 = pass(107.5) * 1.25;
      const ending20 = pass(108.5) * 1.25;
      const ending21 = (pass(109) | 0) + 4;
      const ending22 = pass(110.5) * 1.25;
      const ending23 = pass(-0);
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
    sum = mix(sum, [kept1, await null, first]);
    disturb();
    note("behind 139", kept4, kept3, kept1, sum);
  } catch (error) {
    note("caught 140", error);
    note("in the catch 141", kept2, kept5, kept4, sum);
  } finally {
    note("in the finally 142", first, sum);
    {
      const ending0 = pass(143.5) * 1.25;
      const ending1 = pass(0) / 0;
      const ending2 = pass(145.5) * 1.25;
      const ending3 = (pass(146) | 0) + 6;
      const ending4 = pass(147.5) * 1.25;
      const ending5 = pass(0) / 0;
      const ending6 = pass(149.5) * 1.25;
      const ending7 = (pass(150) | 0) + 3;
      const ending8 = (pass(151) | 0) + 4;
      const ending9 = pass(152.5) * 1.25;
      const ending10 = (pass(153) | 0) + 6;
      const ending11 = (pass(154) | 0) + 0;
      const ending12 = pass(155.5) * 1.25;
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
    sum = mix(
      sum,
      new Box(
        kept5,
        await {
          then(resolve) {
            disturb();
            resolve(156);
          },
        },
      ),
    );
    disturb();
  }
  kept4 = BigInt(pass(173)) * 3n;
  {
    const ending0 = (pass(174) | 0) + 6;
    const ending1 = pass(175.5) * 1.25;
    sum = mix(sum, ending0 + ending1);
  }
  note("before 176", kept6, kept2, kept4, kept5, sum);
  sum = mix(
    sum,
    await {
      then(resolve) {
        disturb();
        resolve(177);
      },
    },
  );
  Bun.gc(true);
  note("behind 204", first, second, sum);
  try {
    kept6 = (pass(205) | 0) + 2;
    {
      const ending0 = { first: pass(206), second: "t206" };
      const ending1 = new Box(pass(207), 207);
      const ending2 = pass(208) > 207;
      const ending3 = () => pass(209) + 4;
      const ending4 = pass(undefined);
      const ending5 = pass(null);
      const ending6 = { first: pass(212), second: "t212" };
      const ending7 = [pass(213), 213.5, "u"];
      const ending8 = pass(214) > 213;
      const ending9 = { first: pass(215), second: "t215" };
      const ending10 = BigInt(pass(216)) * 3n;
      const ending11 = pass(217) > 216;
      const ending12 = pass(0) / 0;
      const ending13 = pass(219) > 220;
      const ending14 = { first: pass(220), second: "t220" };
      const ending15 = { first: pass(221), second: "t221" };
      const ending16 = pass(undefined);
      const ending17 = pass(223) > 222;
      const ending18 = pass(224) > 223;
      const ending19 = [pass(225), 225.5, "u"];
      const ending20 = pass(226) > 225;
      const ending21 = "s" + pass(227);
      const ending22 = pass(228) > 229;
      const ending23 = "s" + pass(229);
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
      ]);
    }
    sum = mix(sum, show(kept5) + show(await answerLater(230)) + show(kept3));
    note("behind 260", first, kept6, kept3, kept4, sum);
    kept6 = pass(261) > 262;
    kept2 = "s" + pass(262);
    {
      const ending0 = (pass(263) | 0) + 4;
      const ending1 = () => pass(264) + 4;
      const ending2 = new Box(pass(265), 265);
      const ending3 = pass(266.5) * 1.25;
      const ending4 = { first: pass(267), second: "t267" };
      sum = mix(sum, ending4);
      sum = mix(sum, ending3);
      sum = mix(sum, ending2);
      sum = mix(sum, ending1);
      sum = mix(sum, ending0);
    }
    note("before 268", kept3, kept2, sum);
    sum = mix(sum, await null);
    note("behind 289", second, kept3, kept1, kept4, sum);
  } finally {
    note("in the finally 290", first, kept4, kept3, kept6, sum);
  }
  note("end", first, second, kept6, kept5, kept4, kept3, kept2, kept1, sum);
  return sum;
}
async function coroutine2(first, second, depth) {
  let sum = mix(first, depth);
  let kept9, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1;
  kept9 = BigInt(pass(1)) * 3n;
  {
    const ending0 = pass(2.5) * 1.25;
    const ending1 = pass(-0);
    const ending2 = (pass(4) | 0) + 4;
    const ending3 = pass(5.5) * 1.25;
    const ending4 = pass(6.5) * 1.25;
    sum = mix(
      sum,
      Math.max(ending0, ending1, ending2, ending3, ending4),
      Math.min(ending0, ending1, ending2, ending3, ending4),
    );
  }
  await pass(7);
  note("behind 33", kept4, sum);
  for (let turn34 = 0; turn34 < 1; turn34++) {
    for (let turn35 = 0; turn35 < 1; turn35++) {
      {
        const ending0 = { first: pass(36), second: "t36" };
        const ending1 = BigInt(pass(37)) * 3n;
        const ending2 = pass(38) > 37;
        const ending3 = { first: pass(39), second: "t39" };
        const ending4 = () => pass(40) + 0;
        sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4));
      }
      sum = mix(sum, await pass(41));
      Bun.gc(true);
      if (turn35 === 0) note("one turn 63", kept3, sum);
      sum = mix(sum, turn35);
    }
    for (let turn64 = 0; turn64 < 2; turn64++) {
      {
        const ending0 = (pass(65) | 0) + 2;
        sum = mix(sum, ending0);
      }
      sum = mix(
        sum,
        Array.of(kept9, await answerLater(66), kept7, await Promise.all([pass(67), Promise.resolve(68)]), kept9),
      );
      disturb();
      note("behind 89", kept4, kept5, sum);
      {
        const ending0 = pass(90) > 91;
        const ending1 = [pass(91), 91.5, "u"];
        const ending2 = () => pass(92) + 2;
        const ending3 = { first: pass(93), second: "t93" };
        const ending4 = pass(0) / 0;
        const ending5 = pass(95.5) * 1.25;
        const ending6 = Symbol.for("y" + pass(96));
        const ending7 = pass(97.5) * 1.25;
        sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7));
      }
      sum = mix(sum, show(kept2) + show(await null) + show(kept7));
      churn(50);
      note("behind 131", kept7, kept8, kept1, sum);
      if (turn64 === 0) note("one turn 132", kept1, first, kept2, sum);
      sum = mix(sum, turn64);
    }
    if (turn34 === 0) note("one turn 133", kept3, sum);
    sum = mix(sum, turn34);
  }
  await Bun.sleep(0);
  let isCollected = false;
  {
    const watched = { name: "w" + pass(134) };
    registry.register(watched, () => void (isCollected = true));
    const ending0 = [pass(135), 135.5, "u"];
    const ending1 = pass(136) > 135;
    const ending2 = { first: pass(137), second: "t137" };
    const ending3 = { first: pass(138), second: "t138" };
    const ending4 = pass(139) > 138;
    const ending5 = { first: pass(140), second: "t140" };
    const ending6 = (pass(141) | 0) + 1;
    const ending7 = pass(142.5) * 1.25;
    sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7));
    sum = mix(sum, readName(watched), readName(watched), watched);
  }
  for (let round = 0; !isCollected && round < 300; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  note("watched", isCollected ? "collected" : "still held");
  note("end", first, second, kept9, kept8, kept7, kept6, kept5, kept4, kept3, kept2, kept1, sum);
  return sum;
}
async function main() {
  await driveAsyncFunctions("async arrow 0", [coroutine0(null, { first: 1 }, 0), coroutine0([1, 2], null, 0)]);
  for (let time = 0; time < 3; time++) {
    await driveAsyncFunctions("async function 1", [coroutine1(1, { first: 1 }, 1), coroutine1([1, 2], 7n, 1)]);
  }
  await driveAsyncFunctions("async function 2", [coroutine2({ first: 1 }, 7n, 0)]);
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
