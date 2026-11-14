const out = [];
function* totals() {
  let sum = 0;
  for (;;) {
    const sent = yield sum;
    sum += sent;
  }
}
const kept = totals();
kept.next();
function repeat(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += kept.next(k & 3).value & 7;
  return n;
}
out.push(repeat(1000), repeat(7));

// What the argument runs is seen by the step.
function* letters() {
  let text = "";
  for (;;) text += yield text;
}
let it = letters();
it.next();
const steps = {
  valueOf() {
    out.push("inner " + it.next("i").value);
    return 1;
  },
};
const replaces = {
  valueOf() {
    it.next = sent => ({ value: "own " + sent, done: false });
    return 2;
  },
};
const removes = {
  valueOf() {
    delete it.next;
    return 3;
  },
};
const ends = {
  valueOf() {
    it.return("ended");
    return 4;
  },
};
const changesPrototype = {
  valueOf() {
    Object.setPrototypeOf(it, { next: () => ({ value: "above", done: false }) });
    return 5;
  },
};
function send(objects) {
  for (let k = 0; k < objects.length; k++) {
    try {
      const { value, done } = it.next(objects[k] + 1);
      out.push(String(value), done);
    } catch (error) {
      out.push(error.name);
    }
  }
}
send([1, 2, steps, 3, replaces, 4, removes, 5, 1n, Symbol.iterator, "s", steps, ends, 6]);
it = letters();
send([0, 1, changesPrototype, 2]);

// A generator that is running, one that throws, one that ends.
function* three() {
  const first = yield 1;
  if (first > 2) throw new RangeError("big");
  return first * 2;
}
for (const sent of [1, 2.5, 3, -0]) {
  const each = three();
  for (let k = 0; k < 4; k++) {
    try {
      const result = each.next(sent * k);
      out.push(Object.is(result.value, -0) ? "-0" : result.value, result.done);
    } catch (error) {
      out.push(error.message);
    }
  }
}
let running;
function* enters() {
  for (;;) {
    try {
      running.next((yield 0) & 1);
    } catch (error) {
      out.push(error.name);
    }
  }
}
running = enters();
for (let k = 0; k < 3; k++) out.push(running.next(k * 2).value);
console.log(out.join());
