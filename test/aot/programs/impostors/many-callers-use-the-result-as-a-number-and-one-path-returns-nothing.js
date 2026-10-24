function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

async function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(await run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

const letters = ["a", "b", "c", "d"];

function offTheEnd(n) {
  if (n > 0) return n;
}

function bareReturn(n) {
  if (n <= 0) return;
  return n;
}

function inASwitch(n) {
  switch (n) {
    case 1:
      return 1;
    case 2:
      return 2;
  }
}

function inALoop(list) {
  for (const item of list) if (item > 1) return item;
}

function inATry(f) {
  try {
    return f();
  } catch {}
}

function overriddenInFinally(n) {
  try {
    return n;
  } finally {
    if (n <= 0) return "from finally";
  }
}

function brokenOutOfFinally(n) {
  out: try {
    return n;
  } finally {
    if (n <= 0) break out;
  }
}

const forgotten = n => {
  n * 2;
};

const voided = n => (n > 0 ? n : void n);

const holder = {
  limit: 2,
  get size() {
    if (this.limit > 0) return this.limit;
  },
  method(n) {
    if (n > 0) return n;
  },
};

function Maker(n) {
  this.n = n;
  if (n > 0) return n;
}

async function later(n) {
  if (n > 0) return n;
}

function* yields(n) {
  const sent = yield n;
  if (sent > 0) return sent;
}

const uses = {
  offTheEnd: n => [offTheEnd(n) * 2, offTheEnd(n) + 1, offTheEnd(n) | 0, offTheEnd(n) < 5, letters[offTheEnd(n)], -offTheEnd(n), offTheEnd(n)],
  bareReturn: n => [bareReturn(n) * 2, bareReturn(n) + 1, bareReturn(n) | 0, bareReturn(n) < 5, letters[bareReturn(n)], -bareReturn(n), bareReturn(n)],
  inASwitch: n => [inASwitch(n) * 2, inASwitch(n) + 1, inASwitch(n) | 0, inASwitch(n) < 5, letters[inASwitch(n)], -inASwitch(n), inASwitch(n)],
  inALoop: n => [inALoop(n) * 2, inALoop(n) + 1, inALoop(n) | 0, inALoop(n) < 5, letters[inALoop(n)], -inALoop(n), inALoop(n)],
  inATry: n => [inATry(n) * 2, inATry(n) + 1, inATry(n) | 0, inATry(n) < 5, letters[inATry(n)], -inATry(n), inATry(n)],
  overriddenInFinally: n => [overriddenInFinally(n) * 2, overriddenInFinally(n) + 1, overriddenInFinally(n) | 0, overriddenInFinally(n) < 5, letters[overriddenInFinally(n)], -overriddenInFinally(n), overriddenInFinally(n)],
  brokenOutOfFinally: n => [brokenOutOfFinally(n) * 2, brokenOutOfFinally(n) + 1, brokenOutOfFinally(n) | 0, brokenOutOfFinally(n) < 5, letters[brokenOutOfFinally(n)], -brokenOutOfFinally(n), brokenOutOfFinally(n)],
  forgotten: n => [forgotten(n) * 2, forgotten(n) + 1, forgotten(n) | 0, forgotten(n) < 5, letters[forgotten(n)], -forgotten(n), forgotten(n)],
  voided: n => [voided(n) * 2, voided(n) + 1, voided(n) | 0, voided(n) < 5, letters[voided(n)], -voided(n), voided(n)],
  getter: n => ((holder.limit = n), [holder.size * 2, holder.size + 1, holder.size | 0, holder.size < 5, letters[holder.size], -holder.size, holder.size]),
  method: n => [holder.method(n) * 2, holder.method(n) + 1, holder.method(n) | 0, holder.method(n) < 5, letters[holder.method(n)], -holder.method(n), holder.method(n)],
  makerCalled: n => [Maker.call({}, n) * 2, Maker.call({}, n) + 1, Maker.call({}, n) | 0, Maker.call({}, n) < 5, letters[Maker.call({}, n)], -Maker.call({}, n), Maker.call({}, n)],
  makerBuilt: n => [new Maker(n) * 2, new Maker(n) + 1, new Maker(n) | 0, new Maker(n) < 5, letters[new Maker(n)], -new Maker(n), new Maker(n)],
  later: async n => [(await later(n)) * 2, (await later(n)) + 1, (await later(n)) | 0, (await later(n)) < 5, letters[await later(n)], -(await later(n)), await later(n)],
  laterNotAwaited: n => [later(n) * 2, later(n) + 1, later(n) | 0, later(n) < 5, letters[later(n)], -later(n)],
  sent: n => { const returned = () => { const it = yields(1); it.next(); return it.next(n).value; }; return [returned() * 2, returned() + 1, returned() | 0, returned() < 5, letters[returned()], -returned(), returned()]; },
};

const cases = [
  ["offTheEnd", 1, 2, 0, -1, NaN, "2", undefined],
  ["bareReturn", 1, 2, 0, -1, NaN, "2", undefined],
  ["inASwitch", 1, 2, 3, 0, "1", undefined],
  ["inALoop", [1, 2], [3], [], [0, 1], ["2"], "29"],
  ["inATry", () => 1, () => 2, () => null.x, () => {}, () => "2", undefined],
  ["overriddenInFinally", 1, 2, 0, -1, NaN, "2"],
  ["brokenOutOfFinally", 1, 2, 0, -1, NaN, "2"],
  ["forgotten", 1, 2],
  ["voided", 1, 2, 0, "2", NaN],
  ["getter", 1, 2, 0, "2", undefined],
  ["method", 1, 2, 0, "2", undefined],
  ["makerCalled", 1, 2, 0, "2"],
  ["makerBuilt", 1, 2, 0],
  ["later", 1, 2, 0, "2"],
  ["laterNotAwaited", 1, 0],
  ["sent", 1, 2, 0, "2", undefined],
];

async function main() {
  for (let round = 0; round < 2; round++) {
    for (const [name, ...inputs] of cases) {
      for (const [i, input] of inputs.entries()) await attempt(round + " " + name + " of " + (typeof input === "function" ? "function number " + i : show(input)), () => uses[name](input));
    }
  }
}

main();
