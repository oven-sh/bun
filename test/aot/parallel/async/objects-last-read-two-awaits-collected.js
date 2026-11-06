// Each coroutine holds many values over its first await. Behind it, it makes an object and more values, reads them all, and then collects in a loop that awaits.
const registry = new FinalizationRegistry(markCollected => markCollected());
const maxRounds = 300;

class Box {
  constructor(first, second) {
    this.first = first;
    this.second = second;
  }
}

const passers = [value => value, value => value];
let passes = 0;
function pass(value) {
  return passers[passes++ & 1](value);
}

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.description;
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

function mix(...values) {
  let sum = 7;
  for (const value of values) for (const unit of show(value)) sum = (sum * 31 + unit.charCodeAt(0)) | 0;
  return sum;
}

function readName(value) {
  return value.name.length;
}

function report(label, isCollected, sum) {
  console.log(label + ":", isCollected ? "collected" : "still held", sum);
}

async function runAsyncFunction(first, depth) {
  let sum = mix(first, depth);
  sum = mix(
    sum,
    Array.of(
      pass(5) > 4,
      { first: pass(6), second: "t6" },
      pass(7.5) * 1.25,
      pass(undefined),
      [pass(9), 9.5, "u"],
      pass(10.5) * 1.25,
      new Box(pass(11), 11),
      new Box(pass(12), 12),
      () => pass(13) + 3,
      [pass(14), 14.5, "u"],
      BigInt(pass(15)) * 3n,
      new Box(pass(16), 16),
      { first: pass(17), second: "t17" },
      [pass(18), 18.5, "u"],
      (pass(19) | 0) + 5,
      Symbol.for("y" + pass(20)),
      pass(-0),
      pass(22) > 21,
      (pass(23) | 0) + 2,
      "s" + pass(24),
      pass(25.5) * 1.25,
      pass(0) / 0,
      () => pass(27) + 2,
      () => pass(28) + 3,
      pass(-0),
      Symbol.for("y" + pass(30)),
      await new Promise(resolve => setTimeout(resolve, 0, 3)),
      depth,
    ),
  );
  let isCollected = false;
  {
    const watched = { name: "w" + pass(32) };
    registry.register(watched, () => void (isCollected = true));
    const ending0 = pass(33) > 34;
    const ending1 = { first: pass(34), second: "t34" };
    const ending2 = new Box(pass(35), 35);
    const ending3 = { first: pass(36), second: "t36" };
    const ending4 = (pass(37) | 0) + 2;
    const ending5 = BigInt(pass(38)) * 3n;
    const ending6 = new Box(pass(39), 39);
    const ending7 = () => pass(40) + 0;
    const ending8 = Symbol.for("y" + pass(41));
    const ending9 = BigInt(pass(42)) * 3n;
    const ending10 = Symbol.for("y" + pass(43));
    const ending11 = () => pass(44) + 4;
    const ending12 = { first: pass(45), second: "t45" };
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
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("an async function", isCollected, sum);
}

const runAsyncArrow = async (first, depth) => {
  let sum = mix(first, depth);
  sum = mix(
    sum,
    Array.of(
      pass(5) > 4,
      { first: pass(6), second: "t6" },
      pass(7.5) * 1.25,
      pass(undefined),
      [pass(9), 9.5, "u"],
      pass(10.5) * 1.25,
      new Box(pass(11), 11),
      new Box(pass(12), 12),
      () => pass(13) + 3,
      [pass(14), 14.5, "u"],
      BigInt(pass(15)) * 3n,
      new Box(pass(16), 16),
      { first: pass(17), second: "t17" },
      [pass(18), 18.5, "u"],
      (pass(19) | 0) + 5,
      Symbol.for("y" + pass(20)),
      pass(-0),
      pass(22) > 21,
      (pass(23) | 0) + 2,
      "s" + pass(24),
      pass(25.5) * 1.25,
      pass(0) / 0,
      () => pass(27) + 2,
      () => pass(28) + 3,
      pass(-0),
      Symbol.for("y" + pass(30)),
      await new Promise(resolve => setTimeout(resolve, 0, 3)),
      depth,
    ),
  );
  let isCollected = false;
  {
    const watched = { name: "w" + pass(32) };
    registry.register(watched, () => void (isCollected = true));
    const ending0 = pass(33) > 34;
    const ending1 = { first: pass(34), second: "t34" };
    const ending2 = new Box(pass(35), 35);
    const ending3 = { first: pass(36), second: "t36" };
    const ending4 = (pass(37) | 0) + 2;
    const ending5 = BigInt(pass(38)) * 3n;
    const ending6 = new Box(pass(39), 39);
    const ending7 = () => pass(40) + 0;
    const ending8 = Symbol.for("y" + pass(41));
    const ending9 = BigInt(pass(42)) * 3n;
    const ending10 = Symbol.for("y" + pass(43));
    const ending11 = () => pass(44) + 4;
    const ending12 = { first: pass(45), second: "t45" };
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
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("an async arrow function", isCollected, sum);
};

const holder = {
  async runAsyncMethod(first, depth) {
    let sum = mix(first, depth);
    sum = mix(
      sum,
      Array.of(
        pass(5) > 4,
        { first: pass(6), second: "t6" },
        pass(7.5) * 1.25,
        pass(undefined),
        [pass(9), 9.5, "u"],
        pass(10.5) * 1.25,
        new Box(pass(11), 11),
        new Box(pass(12), 12),
        () => pass(13) + 3,
        [pass(14), 14.5, "u"],
        BigInt(pass(15)) * 3n,
        new Box(pass(16), 16),
        { first: pass(17), second: "t17" },
        [pass(18), 18.5, "u"],
        (pass(19) | 0) + 5,
        Symbol.for("y" + pass(20)),
        pass(-0),
        pass(22) > 21,
        (pass(23) | 0) + 2,
        "s" + pass(24),
        pass(25.5) * 1.25,
        pass(0) / 0,
        () => pass(27) + 2,
        () => pass(28) + 3,
        pass(-0),
        Symbol.for("y" + pass(30)),
        await new Promise(resolve => setTimeout(resolve, 0, 3)),
        depth,
      ),
    );
    let isCollected = false;
    {
      const watched = { name: "w" + pass(32) };
      registry.register(watched, () => void (isCollected = true));
      const ending0 = pass(33) > 34;
      const ending1 = { first: pass(34), second: "t34" };
      const ending2 = new Box(pass(35), 35);
      const ending3 = { first: pass(36), second: "t36" };
      const ending4 = (pass(37) | 0) + 2;
      const ending5 = BigInt(pass(38)) * 3n;
      const ending6 = new Box(pass(39), 39);
      const ending7 = () => pass(40) + 0;
      const ending8 = Symbol.for("y" + pass(41));
      const ending9 = BigInt(pass(42)) * 3n;
      const ending10 = Symbol.for("y" + pass(43));
      const ending11 = () => pass(44) + 4;
      const ending12 = { first: pass(45), second: "t45" };
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
    for (let round = 0; !isCollected && round < maxRounds; round++) {
      Bun.gc(true);
      await Bun.sleep(0);
    }
    report("an async method", isCollected, sum);
  },
};

async function* runAsyncGenerator(first, depth) {
  let sum = mix(first, depth);
  sum = mix(
    sum,
    Array.of(
      pass(5) > 4,
      { first: pass(6), second: "t6" },
      pass(7.5) * 1.25,
      pass(undefined),
      [pass(9), 9.5, "u"],
      pass(10.5) * 1.25,
      new Box(pass(11), 11),
      new Box(pass(12), 12),
      () => pass(13) + 3,
      [pass(14), 14.5, "u"],
      BigInt(pass(15)) * 3n,
      new Box(pass(16), 16),
      { first: pass(17), second: "t17" },
      [pass(18), 18.5, "u"],
      (pass(19) | 0) + 5,
      Symbol.for("y" + pass(20)),
      pass(-0),
      pass(22) > 21,
      (pass(23) | 0) + 2,
      "s" + pass(24),
      pass(25.5) * 1.25,
      pass(0) / 0,
      () => pass(27) + 2,
      () => pass(28) + 3,
      pass(-0),
      Symbol.for("y" + pass(30)),
      yield 3,
      depth,
    ),
  );
  let isCollected = false;
  {
    const watched = { name: "w" + pass(32) };
    registry.register(watched, () => void (isCollected = true));
    const ending0 = pass(33) > 34;
    const ending1 = { first: pass(34), second: "t34" };
    const ending2 = new Box(pass(35), 35);
    const ending3 = { first: pass(36), second: "t36" };
    const ending4 = (pass(37) | 0) + 2;
    const ending5 = BigInt(pass(38)) * 3n;
    const ending6 = new Box(pass(39), 39);
    const ending7 = () => pass(40) + 0;
    const ending8 = Symbol.for("y" + pass(41));
    const ending9 = BigInt(pass(42)) * 3n;
    const ending10 = Symbol.for("y" + pass(43));
    const ending11 = () => pass(44) + 4;
    const ending12 = { first: pass(45), second: "t45" };
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
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("an async generator", isCollected, sum);
}

await runAsyncFunction({ first: 1 }, 0);
await runAsyncArrow({ first: 2 }, 1);
await holder.runAsyncMethod({ first: 3 }, 2);
for await (const step of runAsyncGenerator({ first: 4 }, 3)) console.log("step", step);
