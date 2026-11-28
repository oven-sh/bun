// A spy of bun:test on a key that a compiled function answers for but does not store: its length, its name, a static field of a class that nothing has used. bind() reads the spy, a refused write leaves it, and a restore brings the function back. Each case has a function or a class of its own, because a key that was stored once stays stored.
import { spyOn } from "bun:test";

const say = (title, body) => {
  let result;
  try {
    result = body();
  } catch (error) {
    result = `${error.name}: ${error.message}`;
  }
  console.log(title, JSON.stringify(result));
};

const kinds = {
  "a function": () => function made(a, b) {},
  "a generator": () => function* made(a, b) {},
  "a class": () => class made { constructor(a, b) {} }, // prettier-ignore
};
const keys = [
  ["length", 9],
  ["name", "spied"],
];
for (const [kind, make] of Object.entries(kinds)) {
  for (const [key, answer] of keys) {
    for (const access of [undefined, "get"]) {
      say(`a ${access ? "getter" : "value"} spy on the ${key} of ${kind}`, () => {
        const fn = make();
        const spy = (access ? spyOn(fn, key, access) : spyOn(fn, key)).mockReturnValue(answer);
        const bound = fn.bind(null, 1);
        let isRefused = false;
        try {
          fn[key] = 5;
        } catch {
          isRefused = true;
        }
        const under = [fn[key], bound[key], isRefused];
        spy.mockRestore();
        return [under, fn[key], fn.bind(null, 1)[key], Object.getOwnPropertyDescriptor(fn, key)];
      });
    }
  }
}

// prettier-ignore
const fields = [
  ["version", "spied", class Read { static version = "1.0.0"; static length = 3; static name = "plugin"; }, class Written { static version = "1.0.0"; static length = 3; static name = "plugin"; }],
  ["length", 9, class Read { static version = "1.0.0"; static length = 3; static name = "plugin"; }, class Written { static version = "1.0.0"; static length = 3; static name = "plugin"; }],
  ["name", "spied", class Read { static version = "1.0.0"; static length = 3; static name = "plugin"; }, class Written { static version = "1.0.0"; static length = 3; static name = "plugin"; }],
];
for (const [key, answer, Read, Written] of fields) {
  say(`a getter spy on the static field ${key}`, () => {
    const spy = spyOn(Read, key, "get").mockReturnValue(answer);
    const bound = Read.bind(null, 1);
    const under = [Read[key], bound.length, bound.name];
    spy.mockRestore();
    return [under, Object.getOwnPropertyNames(Read), Object.getOwnPropertyDescriptor(Read, key)];
  });
  say(`a setter spy on the static field ${key}`, () => {
    const spy = spyOn(Written, key, "set");
    Written[key] = 5;
    const calls = spy.mock.calls;
    spy.mockRestore();
    return [calls, Object.getOwnPropertyNames(Written), Object.getOwnPropertyDescriptor(Written, key)];
  });
}
