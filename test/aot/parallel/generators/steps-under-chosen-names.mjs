// A driver that resumes an iterator with iterator[name](value), where name is "next" until a value is an error.
const lines = [];
const show = value =>
  Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : value instanceof Error ? value.message : Array.isArray(value) ? `[${value.map(show).join()}]` : typeof value === "object" && value !== null ? `{${Object.keys(value).map(key => key + ":" + show(value[key])).join()}}` : String(value);
const say = (...parts) => lines.push(parts.map(show).join(" "));
let reads = 0;

const isFunction = value => typeof value === "function";
const isIterator = value => value && isFunction(value.next) && isFunction(value.throw) && isFunction(value.return);
const isPromise = value => value && isFunction(value.then);

function toValueSync(iterator) {
  if (!isIterator(iterator)) return iterator;
  let value;
  let done = false;
  let next = "next";
  do {
    const state = iterator[next](value);
    done = state.done;
    value = state.value;
    next = "next";
    if (isIterator(value)) {
      try {
        value = toValueSync(value);
      } catch (error) {
        next = "throw";
        value = error;
      }
    }
  } while (!done);
  return value;
}
async function toPromise(iterator) {
  if (!isIterator(iterator)) return iterator;
  let value;
  let done = false;
  let next = "next";
  do {
    const state = iterator[next](value);
    done = state.done;
    value = state.value;
    next = "next";
    try {
      if (isIterator(value)) value = toPromise(value);
      if (isPromise(value)) value = await value;
    } catch (error) {
      next = "throw";
      value = error;
    }
  } while (!done);
  return value;
}
function drive(iterator, limit) {
  let name = "next";
  let value;
  let state;
  const seen = [];
  for (let step = 0; step < limit; step++) {
    state = iterator[name](value);
    if (state.done) break;
    value = state.value;
    seen.push(value);
    name = step === 2 ? "throw" : step === 5 ? "return" : "next";
  }
  return [seen, state.done, state.value];
}

function* leaf(value) {
  return value + 1;
}
function* failing(value) {
  yield value;
  if (value > 2) throw new Error("failing " + value);
  return -0;
}
function* expression(left, right) {
  const first = yield leaf(left);
  let second;
  try {
    second = yield failing(right);
  } catch (error) {
    second = yield error.message;
  }
  return [first, second, yield [left], yield];
}
function* catching(count) {
  for (let step = 0; step < count; step++) {
    try {
      yield step * 0.5;
    } catch (error) {
      yield ["caught", error];
    }
  }
  return "end";
}
function* cleaning(count) {
  try {
    for (let step = 0; step < count; step++) yield step;
  } finally {
    say("cleaned", count);
    if (count === 7) yield "late";
  }
}
class Foreign {
  constructor(value) {
    this.value = value;
    this.steps = 0;
  }
  next(sent) {
    return this.steps++ < 4 ? { value: [this.value, sent], done: false } : { done: true };
  }
  throw(error) {
    return { value: "thrown", done: error === undefined };
  }
  return(value) {
    return { value, done: true };
  }
}
const observed = value => ({
  next: () => ({
    get done() {
      reads++;
      return value <= 0;
    },
    get value() {
      reads += 10;
      return value--;
    },
  }),
  throw: () => ({ done: true, value: "observed" }),
  return: () => ({ done: true }),
});
const replaced = value => {
  const generator = catching(value);
  generator.next = () => ({ done: value-- < 0, value: "replaced" });
  return generator;
};
const makers = [catching, cleaning, value => new Foreign(value), observed, replaced, value => [value, 2, 3][Symbol.iterator](), failing, value => catching(value + 5)];

for (let round = 0; round < 3; round++) {
  for (let left = 0; left < 5; left++) {
    say(toValueSync(expression(left, left)), toValueSync(left), toValueSync(leaf(2147483646 + left)));
    for (const make of makers) {
      try {
        say(drive(make(left), 9));
      } catch (error) {
        say(error.name, error);
      }
    }
    try {
      say(drive(cleaning(7), 9));
    } catch (error) {
      say(error, reads);
    }
  }
  let total = 0;
  for (let k = 0; k < 40; k++) total += drive(catching(k & 3), 4)[0].length + toValueSync(leaf(k));
  say(total);
}
const generator = catching(3);
say(generator["next"]().value, generator[lines.length ? "next" : "throw"]().value, generator[lines.length ? "return" : "next"](7));
const later = [];
for (let left = 0; left < 5; left++) later.push(toPromise(expression(Promise.resolve(left).then ? left : 0, left)).then(say));
Promise.all(later).then(() => console.log(lines.join("\n")));
