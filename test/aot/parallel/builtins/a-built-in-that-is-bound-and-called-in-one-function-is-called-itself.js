// `next = iterator.next.bind(iterator)`, as the helper that Babel emits for `for (x of list)` in loose mode answers it, and other built-ins bound where they are called.
// The call of what bind answered is a call of the built-in on what was bound.
// COUNT: arrivals <= 60
function stepsOf(list) {
  const iterator = list[Symbol.iterator]();
  return iterator.next.bind(iterator);
}
function orClosure(list, bound) {
  if (bound) return stepsOf(list);
  let position = 0;
  return function () {
    return position >= list.length ? { done: true } : { done: false, value: list[position++] };
  };
}
const numbers = [1, 2, 3, 4];
function sumByBoundNext(start) {
  let sum = start;
  for (let next = stepsOf(numbers), step; !(step = next()).done; ) sum += step.value;
  return sum;
}
function sumByEither(start) {
  let sum = start;
  for (let next = orClosure(numbers, true), step; !(step = next()).done; ) sum += step.value;
  return sum;
}
let total = 0;
for (let turn = 0; turn < 1000; turn++) total += sumByBoundNext(turn & 7) + sumByEither(turn & 3);
console.log(total);

const lines = [];
function say(name, make) {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  lines.push(name + ": " + (typeof answer === "object" && answer ? JSON.stringify(answer) : String(answer)));
}
say("bound arguments come first", () => Math.max.bind(null, 5)(1, 7, 3) + " " + Math.max.bind(null, 9, 2)(1));
say("nothing bound", () => JSON.stringify(Object.assign.bind()({}, { a: 1 }, { b: 2 })));
say("what the call is made on does not count", () => {
  const holder = { has: Object.prototype.hasOwnProperty.bind({ mine: 1 }), other: 1 };
  const has = Object.prototype.hasOwnProperty.bind({ mine: 1 });
  return [has("mine"), has("other"), has.call({ other: 1 }, "other"), holder.has("other"), holder.has("mine")].join();
});
say("a primitive is bound", () => String.prototype.toUpperCase.bind("abc")() + Number.prototype.toFixed.bind(1.5, 2)());
say("undefined is bound where an object is asked for", () => Array.prototype.slice.bind(undefined)());
say("the wrong object is bound", () => [][Symbol.iterator]().next.bind(5)());
say("a callback runs", () => {
  const seen = [];
  Array.prototype.forEach.bind([1, 2])(function (value, index) {
    seen.push(value + ":" + index + ":" + (this === undefined));
  });
  return seen.join();
});
say("bound twice", () => Math.min.bind(null, 4).bind(null, 2)(3) + " " + Array.prototype.join.bind([1, 2]).bind([3, 4])("-"));
say("what it is, beside the call", () => {
  const bound = Object.keys.bind(null);
  return [bound({ a: 1 }).join(), bound.name, bound.length, typeof bound, bound === Object.keys, "prototype" in bound, bound instanceof Function].join();
});
say("kept, and called later too", () => {
  const kept = [];
  const bound = Array.prototype.push.bind(kept);
  bound(1);
  const again = [bound][0];
  again(2, 3);
  return kept.join();
});
say("constructed", () => {
  const Bound = Array.bind(null, 3);
  return [new Bound().length, Bound().length, new Bound(4).join(), new Bound() instanceof Array].join();
});
say("no constructor", () => new (Math.max.bind(null))());
say("one of two", () => {
  const answers = [];
  for (const first of [true, false]) {
    const bound = first ? Math.max.bind(null, 2) : Math.min.bind(null, 2);
    answers.push(bound(1, 3));
  }
  return answers.join();
});
say("the name is stored to between", () => {
  let bound = Math.abs.bind(null);
  const first = bound(-1);
  bound = Math.sign.bind(null);
  return first + " " + bound(-5);
});
say("what was bound changes behind the bind", () => {
  const list = [1];
  const joined = Array.prototype.join.bind(list, "+");
  list.push(2);
  return joined();
});
say("spread and apply", () => {
  const most = Math.max.bind(null, 1);
  return [most(...[4, 2]), most.apply(null, [5]), most.call(null, 6), Reflect.apply(most, null, [7])].join();
});
say("the frames of an error", () => {
  const assign = Object.assign.bind();
  try {
    assign(null);
  } catch (error) {
    return error.stack
      .split("\n")
      .slice(0, 2)
      .map(line => line.trim().replace(/\(.*[\\/]/, "("))
      .join(" | ");
  }
});
console.log(lines.join("\n"));
