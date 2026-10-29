// Seed 653 of fuzz/values-that-end-before-a-suspension-beside-values-that-cross-it.ts, with an object that is last read before a loop of collections and waits; the coroutine waits for a timer before it makes the object, as the loop does.
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
  churn(300);
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

async function* coroutine0(first, second, depth) {
  let sum = mix(first, depth);
  let kept4, kept3, kept2, kept1;
  for (let turn1 = 0; turn1 < 1; turn1++) {
    kept3 = () => pass(2) + 2;
    {
      const ending0 = (pass(3) | 0) + 3;
      const ending1 = (pass(4) | 0) + 4;
      const ending2 = pass(-0);
      const ending3 = pass(0) / 0;
      const ending4 = (pass(7) | 0) + 0;
      const ending5 = pass(0) / 0;
      const ending6 = pass(-0);
      const ending7 = pass(10.5) * 1.25;
      const ending8 = (pass(11) | 0) + 4;
      const ending9 = (pass(12) | 0) + 5;
      const ending10 = pass(13.5) * 1.25;
      const ending11 = (pass(14) | 0) + 0;
      const ending12 = pass(-0);
      const ending13 = pass(0) / 0;
      const ending14 = pass(17.5) * 1.25;
      const ending15 = pass(0) / 0;
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
    note("before 19", first, sum);
    sum = mix(
      sum,
      Array.of(
        Symbol.for("y" + pass(22)),
        { first: pass(23), second: "t23" },
        pass(24) > 25,
        BigInt(pass(25)) * 3n,
        BigInt(pass(26)) * 3n,
        Symbol.for("y" + pass(27)),
        pass(28.5) * 1.25,
        new Box(pass(29), 29),
        pass(30) > 31,
        pass(31) > 30,
        pass(0) / 0,
        BigInt(pass(33)) * 3n,
        { first: pass(34), second: "t34" },
        () => pass(35) + 0,
        BigInt(pass(36)) * 3n,
        "s" + pass(37),
        pass(0) / 0,
        Symbol.for("y" + pass(39)),
        pass(0) / 0,
        pass(41.5) * 1.25,
        pass(undefined),
        (pass(43) | 0) + 1,
        await null,
        second,
      ),
    );
    note("behind 45", second, kept2, kept4, sum);
    if (turn1 === 0) note("one turn 46", kept1, second, sum);
    sum = mix(sum, turn1);
  }
  for (let turn47 = 0; turn47 < 1; turn47++) {
    try {
      kept3 = [pass(48), 48.5, "u"];
      kept1 = "s" + pass(49);
      kept2 = new Box(pass(50), 50);
      kept4 = pass(null);
      {
        const ending0 = pass(52) > 51;
        const ending1 = pass(-0);
        const ending2 = { first: pass(54), second: "t54" };
        const ending3 = () => pass(55) + 0;
        const ending4 = pass(56.5) * 1.25;
        const ending5 = new Box(pass(57), 57);
        const ending6 = pass(undefined);
        const ending7 = pass(-0);
        const ending8 = () => pass(60) + 0;
        const ending9 = pass(61) > 60;
        const ending10 = pass(0) / 0;
        const ending11 = () => pass(63) + 3;
        const ending12 = () => pass(64) + 4;
        const ending13 = [pass(65), 65.5, "u"];
        const ending14 = pass(undefined);
        const ending15 = pass(null);
        const ending16 = { first: pass(68), second: "t68" };
        const ending17 = pass(69) > 70;
        const ending18 = [pass(70), 70.5, "u"];
        const ending19 = pass(71) > 70;
        const ending20 = pass(72) > 73;
        const ending21 = (pass(73) | 0) + 3;
        const ending22 = (pass(74) | 0) + 4;
        const ending23 = { first: pass(75), second: "t75" };
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
        );
      }
      sum = mix(second, await Promise.all([pass(76), Promise.resolve(77)]), kept2);
      kept4 = { first: pass(108), second: "t108" };
      kept1 = pass(-0);
      kept3 = [pass(110), 110.5, "u"];
      {
        const ending0 = [pass(111), 111.5, "u"];
        const ending1 = "s" + pass(112);
        const ending2 = pass(null);
        const ending3 = new Box(pass(114), 114);
        const ending4 = pass(-0);
        const ending5 = "s" + pass(116);
        const ending6 = () => pass(117) + 2;
        const ending7 = "s" + pass(118);
        const ending8 = { first: pass(119), second: "t119" };
        const ending9 = (pass(120) | 0) + 1;
        const ending10 = BigInt(pass(121)) * 3n;
        const ending11 = pass(122.5) * 1.25;
        const ending12 = new Box(pass(123), 123);
        const ending13 = pass(0) / 0;
        const ending14 = [pass(125), 125.5, "u"];
        const ending15 = pass(undefined);
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
        );
      }
      sum = mix(sum, [kept2, yield 127, kept4]);
      {
        const ending0 = (pass(144) | 0) + 4;
        const ending1 = (pass(145) | 0) + 5;
        const ending2 = pass(0) / 0;
        const ending3 = (pass(147) | 0) + 0;
        const ending4 = (pass(148) | 0) + 1;
        const ending5 = pass(-0);
        const ending6 = pass(150.5) * 1.25;
        const ending7 = pass(-0);
        const ending8 = (pass(152) | 0) + 5;
        const ending9 = pass(-0);
        const ending10 = (pass(154) | 0) + 0;
        const ending11 = pass(155.5) * 1.25;
        const ending12 = pass(156.5) * 1.25;
        const ending13 = (pass(157) | 0) + 3;
        const ending14 = pass(0) / 0;
        const ending15 = pass(159.5) * 1.25;
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
        );
        sum = mix(sum, list.splice(0));
      }
      note("before 160", first, sum);
      for await (const item of [pass(181), Promise.resolve(second)]) sum = mix(sum, item, second);
      note("behind 182", kept4, first, sum);
    } catch (error) {
      note("caught 183", error);
      note("in the catch 184", kept2, first, second, kept3, sum);
    }
    kept2 = { first: pass(185), second: "t185" };
    {
      const ending0 = pass(undefined);
      const ending1 = Symbol.for("y" + pass(187));
      const ending2 = new Box(pass(188), 188);
      const ending3 = BigInt(pass(189)) * 3n;
      const ending4 = pass(190.5) * 1.25;
      sum = mix(sum, ending4);
      sum = mix(sum, ending3);
      sum = mix(sum, ending2);
      sum = mix(sum, ending1);
      sum = mix(sum, ending0);
    }
    note("before 191", kept2, kept4, sum);
    sum = mix(sum, new Box(kept1, await Promise.all([pass(192), Promise.resolve(193)])));
    note("behind 216", first, sum);
    if (turn47 === 0) note("one turn 217", kept3, second, first, sum);
    sum = mix(sum, turn47);
  }
  note("end", first, second, kept4, kept3, kept2, kept1, sum);
  return sum;
}
const coroutine1 = async (first, second, depth) => {
  let sum = mix(first, depth);
  let kept4, kept3, kept2, kept1;
  for (let turn1 = 0; turn1 < 1; turn1++) {
    {
      const ending0 = (pass(2) | 0) + 2;
      const ending1 = [pass(3), 3.5, "u"];
      const ending2 = Symbol.for("y" + pass(4));
      const ending3 = { first: pass(5), second: "t5" };
      const ending4 = pass(6.5) * 1.25;
      const ending5 = new Box(pass(7), 7);
      const ending6 = new Box(pass(8), 8);
      const ending7 = new Box(pass(9), 9);
      const ending8 = Symbol.for("y" + pass(10));
      const ending9 = { first: pass(11), second: "t11" };
      const ending10 = pass(12) > 13;
      const ending11 = pass(null);
      const ending12 = pass(14.5) * 1.25;
      const ending13 = BigInt(pass(15)) * 3n;
      const ending14 = (pass(16) | 0) + 2;
      const ending15 = [pass(17), 17.5, "u"];
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
      );
      sum = mix(sum, list.splice(0));
    }
    note("before 18", kept3, first, kept1, sum);
    await answerLater(19);
    if (turn1 === 0) note("one turn 40", kept2, first, kept3, sum);
    sum = mix(sum, turn1);
  }
  kept1 = (pass(41) | 0) + 6;
  {
    const ending0 = (pass(42) | 0) + 0;
    const ending1 = pass(null);
    const ending2 = new Box(pass(44), 44);
    const ending3 = [pass(45), 45.5, "u"];
    const ending4 = () => pass(46) + 1;
    const ending5 = "s" + pass(47);
    const ending6 = (pass(48) | 0) + 6;
    const ending7 = [pass(49), 49.5, "u"];
    sum = mix(sum, Array.of(ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7));
  }
  note("before 50", kept1, sum);
  sum = mix(sum, Array.of(kept4, await answerLater(51), kept3, await null, kept4));
  await Bun.sleep(0);
  let isCollected = false;
  {
    const watched = { name: "w" + pass(67) };
    registry.register(watched, () => void (isCollected = true));
    const ending0 = (pass(68) | 0) + 5;
    const ending1 = "s" + pass(69);
    const ending2 = pass(0) / 0;
    const ending3 = (pass(71) | 0) + 1;
    const ending4 = "s" + pass(72);
    const ending5 = [pass(73), 73.5, "u"];
    const ending6 = (pass(74) | 0) + 4;
    const ending7 = { first: pass(75), second: "t75" };
    const ending8 = pass(76) > 75;
    const ending9 = Symbol.for("y" + pass(77));
    const ending10 = { first: pass(78), second: "t78" };
    const ending11 = { first: pass(79), second: "t79" };
    const ending12 = "s" + pass(80);
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
    sum = mix(sum, readName(watched), readName(watched), watched);
  }
  for (let round = 0; !isCollected && round < 300; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  note("watched", isCollected ? "collected" : "still held");
  note("end", first, second, kept4, kept3, kept2, kept1, sum);
  return sum;
};
const holderOfcoroutine2 = {
  *run(first, second, depth) {
    let sum = mix(first, depth);
    let kept2, kept1;
    kept2 = { first: pass(1), second: "t1" };
    {
      const ending0 = pass(2.5) * 1.25;
      const ending1 = pass(3.5) * 1.25;
      sum = mix(sum, Math.max(ending0, ending1), Math.min(ending0, ending1));
    }
    sum = mix(sum, [second, yield* countUp(4), kept1]);
    churn(50);
    note("behind 13", second, kept2, kept1, sum);
    try {
      for (let turn14 = 0; turn14 < 4; turn14++) {
        {
          const ending0 = { first: pass(15), second: "t15" };
          const ending1 = pass(undefined);
          const ending2 = Symbol.for("y" + pass(17));
          const ending3 = pass(undefined);
          const ending4 = { first: pass(19), second: "t19" };
          const ending5 = (pass(20) | 0) + 6;
          const ending6 = new Box(pass(21), 21);
          const ending7 = new Box(pass(22), 22);
          const ending8 = pass(-0);
          const ending9 = pass(undefined);
          const ending10 = BigInt(pass(25)) * 3n;
          const ending11 = (pass(26) | 0) + 5;
          const ending12 = "s" + pass(27);
          const ending13 = new Box(pass(28), 28);
          const ending14 = (pass(29) | 0) + 1;
          const ending15 = pass(undefined);
          const ending16 = [pass(31), 31.5, "u"];
          const ending17 = BigInt(pass(32)) * 3n;
          const ending18 = () => pass(33) + 3;
          const ending19 = Symbol.for("y" + pass(34));
          const ending20 = pass(null);
          const ending21 = BigInt(pass(36)) * 3n;
          const ending22 = Symbol.for("y" + pass(37));
          const ending23 = (pass(38) | 0) + 3;
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
        yield pass(39);
        note("behind 51", kept2, sum);
        if (turn14 === 3) note("one turn 52", kept1, first, second, kept2, sum);
        sum = mix(sum, turn14);
      }
      {
        const ending0 = pass(-0);
        const ending1 = pass(0) / 0;
        const ending2 = pass(-0);
        const ending3 = pass(56) > 55;
        const ending4 = (pass(57) | 0) + 1;
        const ending5 = [pass(58), 58.5, "u"];
        const ending6 = (pass(59) | 0) + 3;
        const ending7 = { first: pass(60), second: "t60" };
        const list = [];
        list.push(ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7);
        sum = mix(sum, list.splice(0));
      }
      yield* [61, 62];
      Bun.gc(true);
      sum = mix(sum, new Box(kept2, yield 80));
      note("behind 105", kept2, sum);
      kept1 = pass(106) > 105;
      {
        const ending0 = (pass(107) | 0) + 2;
        const ending1 = pass(0) / 0;
        const ending2 = (pass(109) | 0) + 4;
        const ending3 = Symbol.for("y" + pass(110));
        const ending4 = (pass(111) | 0) + 6;
        const ending5 = "s" + pass(112);
        const ending6 = () => pass(113) + 3;
        const ending7 = pass(0) / 0;
        const ending8 = pass(null);
        const ending9 = pass(undefined);
        const ending10 = pass(null);
        const ending11 = pass(118) > 117;
        const ending12 = pass(-0);
        const ending13 = "s" + pass(120);
        const ending14 = pass(-0);
        const ending15 = [pass(122), 122.5, "u"];
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
        );
        sum = mix(sum, list.splice(0));
      }
      note("before 123", first, kept1, sum);
      sum = mix(sum, show(second) + show(yield 124) + show(kept1));
      Bun.gc(true);
      note("behind 147", kept2, sum);
    } finally {
      note("in the finally 148", kept1, first, second, sum);
      kept2 = "s" + pass(149);
      kept1 = () => pass(150) + 0;
      {
        const ending0 = (pass(151) | 0) + 4;
        const ending1 = pass(0) / 0;
        const ending2 = pass(153.5) * 1.25;
        const ending3 = (pass(154) | 0) + 0;
        const ending4 = pass(-0);
        sum = mix(sum, ending4);
        sum = mix(sum, ending3);
        sum = mix(sum, ending2);
        sum = mix(sum, ending1);
        sum = mix(sum, ending0);
      }
      note("before 156", second, first, kept1, kept2, sum);
      yield mix(sum, 157);
    }
    try {
      try {
        kept1 = pass(170) > 169;
        {
          const ending0 = pass(171.5) * 1.25;
          const ending1 = pass(0) / 0;
          const ending2 = pass(173.5) * 1.25;
          const ending3 = (pass(174) | 0) + 6;
          const ending4 = pass(175.5) * 1.25;
          const ending5 = pass(0) / 0;
          const ending6 = (pass(177) | 0) + 2;
          const ending7 = (pass(178) | 0) + 3;
          const ending8 = pass(-0);
          const ending9 = (pass(180) | 0) + 5;
          const ending10 = pass(181.5) * 1.25;
          const ending11 = pass(0) / 0;
          const ending12 = pass(-0);
          const ending13 = pass(184.5) * 1.25;
          const ending14 = pass(-0);
          const ending15 = pass(186.5) * 1.25;
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
        sum = mix(kept1, yield pass(187), kept1);
        note("behind 206", kept2, kept1, sum);
        sum = mix(sum, Array.of(second, yield mix(sum, 207), kept2, yield 208, second));
        disturb();
        note("behind 226", second, sum);
        {
          const ending0 = new Box(pass(227), 227);
          const ending1 = new Box(pass(228), 228);
          const ending2 = pass(229.5) * 1.25;
          const ending3 = (pass(230) | 0) + 6;
          const ending4 = pass(null);
          const ending5 = pass(undefined);
          const ending6 = (pass(233) | 0) + 2;
          const ending7 = pass(234) > 235;
          sum = mix(sum, ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7);
        }
        note("before 235", first, kept2, second, kept1, sum);
        sum = mix(sum, yield* countUp(236));
        note("behind 241", first, second, kept2, sum);
        kept1 = () => pass(242) + 2;
        kept2 = pass(243) > 244;
        sum = mix(sum, new Box(kept1, yield 244));
        churn(50);
      } catch (error) {
        note("caught 262", error);
        note("in the catch 263", first, kept1, kept2, sum);
      }
      {
        const ending0 = pass(264.5) * 1.25;
        const ending1 = [pass(265), 265.5, "u"];
        const ending2 = pass(266.5) * 1.25;
        const ending3 = pass(-0);
        const ending4 = (pass(268) | 0) + 2;
        const ending5 = pass(-0);
        const ending6 = (pass(270) | 0) + 4;
        const ending7 = { first: pass(271), second: "t271" };
        const ending8 = { first: pass(272), second: "t272" };
        const ending9 = () => pass(273) + 3;
        const ending10 = [pass(274), 274.5, "u"];
        const ending11 = Symbol.for("y" + pass(275));
        const ending12 = pass(undefined);
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
      sum = mix(sum, { first: first, second: yield 277, third: second });
      kept1 = [pass(301), 301.5, "u"];
      {
        const ending0 = pass(undefined);
        const ending1 = { first: pass(303), second: "t303" };
        sum = mix(sum, ending0, ending1);
      }
      yield* countUp(304);
      note("behind 318", first, kept2, sum);
    } catch (error) {
      note("caught 319", error);
      note("in the catch 320", kept1, kept2, first, sum);
    }
    try {
      try {
        {
          const ending0 = pass(null);
          const ending1 = new Box(pass(322), 322);
          const ending2 = pass(-0);
          const ending3 = Symbol.for("y" + pass(324));
          const ending4 = { first: pass(325), second: "t325" };
          const ending5 = pass(undefined);
          const ending6 = "s" + pass(327);
          const ending7 = pass(328.5) * 1.25;
          const ending8 = (pass(329) | 0) + 0;
          const ending9 = pass(undefined);
          const ending10 = pass(331.5) * 1.25;
          const ending11 = new Box(pass(332), 332);
          const ending12 = (pass(333) | 0) + 4;
          const ending13 = BigInt(pass(334)) * 3n;
          const ending14 = BigInt(pass(335)) * 3n;
          const ending15 = () => pass(336) + 1;
          const ending16 = "s" + pass(337);
          const ending17 = pass(0) / 0;
          const ending18 = pass(339) > 340;
          const ending19 = [pass(340), 340.5, "u"];
          const ending20 = Symbol.for("y" + pass(341));
          const ending21 = new Box(pass(342), 342);
          const ending22 = pass(-0);
          const ending23 = pass(344.5) * 1.25;
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
          );
        }
        sum = mix(sum, { first: first, second: yield mix(sum, 345), third: kept2 });
        disturb();
        {
          const ending0 = pass(367.5) * 1.25;
          const ending1 = () => pass(368) + 3;
          const ending2 = pass(null);
          const ending3 = BigInt(pass(370)) * 3n;
          const ending4 = new Box(pass(371), 371);
          sum = mix(sum, ending0, ending1, ending2, ending3, ending4);
        }
        note("before 372", first, second, kept2, kept1, sum);
        sum = mix(sum, [kept2, yield 373, second]);
      } finally {
        note("in the finally 403", first, second, kept2, sum);
      }
      kept2 = [pass(404), 404.5, "u"];
      {
        const ending0 = new Box(pass(405), 405);
        const ending1 = { first: pass(406), second: "t406" };
        const ending2 = () => pass(407) + 2;
        sum = mix(sum, Array.of(ending0, ending1, ending2));
      }
      sum = mix(
        sum,
        Array.of(
          pass(0) / 0,
          () => pass(411) + 1,
          pass(0) / 0,
          new Box(pass(413), 413),
          BigInt(pass(414)) * 3n,
          pass(415) > 414,
          () => pass(416) + 1,
          "s" + pass(417),
          new Box(pass(418), 418),
          pass(null),
          () => pass(420) + 0,
          pass(null),
          [pass(422), 422.5, "u"],
          [pass(423), 423.5, "u"],
          "s" + pass(424),
          "s" + pass(425),
          "s" + pass(426),
          (pass(427) | 0) + 0,
          { first: pass(428), second: "t428" },
          pass(-0),
          "s" + pass(430),
          Symbol.for("y" + pass(431)),
          Symbol.for("y" + pass(432)),
          { first: pass(433), second: "t433" },
          yield* countUp(408),
          first,
        ),
      );
      note("behind 434", kept1, second, first, kept2, sum);
      kept2 = pass(435.5) * 1.25;
      {
        const ending0 = pass(0) / 0;
        const ending1 = () => pass(437) + 2;
        const ending2 = "s" + pass(438);
        const ending3 = new Box(pass(439), 439);
        const ending4 = "s" + pass(440);
        const ending5 = new Box(pass(441), 441);
        const ending6 = new Box(pass(442), 442);
        const ending7 = (pass(443) | 0) + 2;
        sum = mix(sum, [ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7]);
      }
      yield 444;
      note("behind 471", kept2, kept1, second, sum);
      kept2 = (pass(472) | 0) + 3;
      kept1 = (pass(473) | 0) + 4;
      {
        const ending0 = "s" + pass(474);
        const ending1 = pass(null);
        const ending2 = new Box(pass(476), 476);
        const ending3 = pass(477) > 478;
        const ending4 = BigInt(pass(478)) * 3n;
        const ending5 = pass(-0);
        const ending6 = [pass(480), 480.5, "u"];
        const ending7 = pass(-0);
        const ending8 = new Box(pass(482), 482);
        const ending9 = BigInt(pass(483)) * 3n;
        const ending10 = "s" + pass(484);
        const ending11 = BigInt(pass(485)) * 3n;
        const ending12 = { first: pass(486), second: "t486" };
        const ending13 = pass(null);
        const ending14 = pass(488) > 487;
        const ending15 = pass(-0);
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
        );
      }
      sum = mix(kept2, yield mix(sum, 490), second);
      note("behind 522", kept2, first, kept1, second, sum);
    } catch (error) {
      note("caught 523", error);
      note("in the catch 524", kept1, sum);
    } finally {
      note("in the finally 525", kept2, sum);
      kept1 = pass(526.5) * 1.25;
      {
        const ending0 = pass(-0);
        const ending1 = pass(undefined);
        const ending2 = { first: pass(529), second: "t529" };
        const ending3 = new Box(pass(530), 530);
        const ending4 = new Box(pass(531), 531);
        const ending5 = { first: pass(532), second: "t532" };
        const ending6 = [pass(533), 533.5, "u"];
        const ending7 = new Box(pass(534), 534);
        sum = mix(sum, [ending0, ending1, ending2, ending3, ending4, ending5, ending6, ending7]);
      }
      sum = mix(sum, Array.of(kept1, yield* [535, 536], kept1, yield* [536, 537], kept1));
      note("behind 559", first, sum);
    }
    note("end", first, second, kept2, kept1, sum);
    return sum;
  },
};
async function main() {
  await driveAsyncGenerators(
    "async generator 0",
    [coroutine0({ first: 1 }, [1, 2], 3), coroutine0(null, "a", 3), coroutine0([1, 2], null, 3)],
    ["next", "next", "next", "next", "next", "next", "next", "next", "next", "next", "next"],
  );
  await driveAsyncFunctions("async arrow 1", [coroutine1({ first: 1 }, new Box(1, 2), 0)]);
  for (let time = 0; time < 30; time++) {
    driveGenerators(
      "generator method 2",
      [holderOfcoroutine2.run(7n, new Box(1, 2), 0), holderOfcoroutine2.run(null, [1, 2], 0)],
      ["return", "next", "next"],
    );
  }
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
