// Small programs about one async function, one thing that it awaits, and a row of jobs beside it that tell the turns apart. A promise of the realm's own `Promise` that is already fulfilled lets the
// function go on one turn later; `await` asks the promise for its `constructor` first, and what is no such promise is resolved by its `then`, which takes more turns. There is one scene, and one line
// is printed at the end, by `console.log` itself.
//
//   what is awaited  a fulfilled promise however it was made, a rejected one, a pending one that the caller settles at once or a turn later, a primitive, a thenable, an instance of a class below
//                    `Promise` with or without a `then` of its own
//   made odd by      a `constructor` of its own, as a value or a getter that tells, a `then` of its own, another prototype, `null` above, `freeze`; or nothing
//   the await        alone, twice, in a loop, in a list, `return await`, `return` of the promise, `for await`, behind `Promise.resolve`, in an async arrow, a method, an async generator
//   beside it        a chain of `then`, `queueMicrotask`, a second function that awaits the same thing
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const [setup, isAPromise] = random.weighted<[string, boolean]>([
    [5, ["const p = Promise.resolve(1);", true]],
    [2, ["const p = new Promise(resolve => resolve(1));", true]],
    [2, ["const p = (async () => 1)();", true]],
    [1, ["const p = Promise.resolve(Promise.resolve(1));", true]],
    [2, ['const p = Promise.reject(new Error("no"));\np.catch(() => {});', true]],
    [2, ["let settle;\nconst p = new Promise(resolve => {\nsettle = resolve;\n});", true]],
    [1, ["const p = Promise.resolve().then(() => 1);", true]],
    [1, ["const p = Promise.all([1]);", true]],
    [1, ["const p = 1;", false]],
    [1, ["const p = undefined;", false]],
    [2, ['const p = {\nthen(resolve) {\nlog.push("then called");\nresolve(1);\n},\n};', false]],
    [3, ["class Sub extends Promise {}\nconst p = Sub.resolve(1);", true]],
    [
      2,
      [
        'class Sub extends Promise {\nthen(...given) {\nlog.push("then of Sub");\nreturn super.then(...given);\n}\n}\nconst p = Sub.resolve(1);',
        true,
      ],
    ],
    [
      1,
      [
        "class Sub extends Promise {\nstatic get [Symbol.species]() {\nreturn Promise;\n}\n}\nconst p = new Sub(resolve => resolve(1));",
        true,
      ],
    ],
  ]);
  const odd = isAPromise
    ? random.weighted([
        [8, ""],
        [3, "p.constructor = function () {};"],
        [
          3,
          'Object.defineProperty(p, "constructor", {\nget() {\nlog.push("constructor asked");\nreturn Promise;\n},\n});',
        ],
        [
          1,
          'Object.defineProperty(p, "constructor", {\nget() {\nlog.push("constructor asked");\nreturn Object;\n},\n});',
        ],
        [
          3,
          'p.then = function (...given) {\nlog.push("own then");\nreturn Promise.prototype.then.apply(this, given);\n};',
        ],
        [1, "p.constructor = Promise;"],
        [1, "p.constructor = undefined;"],
        [2, "Object.setPrototypeOf(p, class extends Promise {}.prototype);"],
        [1, "Object.setPrototypeOf(p, null);"],
        [1, "Object.setPrototypeOf(p, { __proto__: Promise.prototype });"],
        [1, "Object.freeze(p);"],
        [1, "p.extra = 1;"],
      ])
    : "";
  const body = random.weighted([
    [6, 'log.push("got " + String(await p));'],
    [2, 'log.push("got " + String(await p));\nlog.push("again " + String(await p));'],
    [1, 'for (let turn = 0; turn < 2; turn++) log.push("got " + String(await p));'],
    [1, 'log.push("got " + [await p, await p].join());'],
    [2, "return await p;"],
    [2, "return p;"],
    [1, 'for await (const each of [p]) log.push("got " + String(each));'],
    [1, 'log.push("got " + String(await Promise.resolve(p)));'],
    [1, 'log.push("got " + String(await (async () => p)()));'],
    [
      1,
      'const before = log.length;\nconst got = await p;\nlog.push("got " + String(got) + " behind " + (log.length - before));',
    ],
  ]);
  const handled = `log.push("in");\ntry {\n${body}\n} catch (error) {\nlog.push("caught " + error.constructor.name);\n}`;
  const shape = random.pick(["declared", "declared", "arrow", "method", "generator"] as const);
  const declared = {
    declared: `async function waits() {\n${handled}\n}`,
    arrow: `const waits = async () => {\n${handled}\n};`,
    method: `const holder = {\nasync waits() {\n${handled}\n},\n};\nconst waits = () => holder.waits();`,
    generator: `async function* steps() {\n${handled.replaceAll(/^return /gm, "yield ")}\n}\nconst waits = async () => {\nfor await (const each of steps()) log.push("yielded " + String(each));\n};`,
  }[shape];
  const beside = random.sample(
    [
      'Promise.resolve()\n.then(() => log.push("turn 1"))\n.then(() => log.push("turn 2"))\n.then(() => log.push("turn 3"))\n.then(() => log.push("turn 4"))\n.then(() => log.push("turn 5"));',
      'queueMicrotask(() => log.push("job"));',
      '(async () => {\ntry {\nawait p;\n} catch {}\nlog.push("the other got it");\n})();',
    ],
    random.pick([1, 1, 2, 3]),
  );
  if (!beside.some(each => each.includes("turn 1")))
    beside.push(
      'Promise.resolve()\n.then(() => log.push("turn 1"))\n.then(() => log.push("turn 2"))\n.then(() => log.push("turn 3"))\n.then(() => log.push("turn 4"));',
    );
  const settles = setup.includes("let settle")
    ? random.pick(["settle(1);", "settle(1);", "queueMicrotask(() => settle(1));", "settle(Promise.resolve(1));"])
    : "";
  const order = random.chance(0.7);
  const scene = [
    "const log = [];",
    setup,
    odd,
    declared,
    order ? "const done = waits();" : beside.join("\n"),
    order ? beside.join("\n") : "const done = waits();",
    settles,
    'log.push("out");',
    'log.push("answered " + String(await done));',
    "for (let turn = 0; turn < 8; turn++) await null;",
    'console.log(log.join(" | "));',
  ]
    .filter(Boolean)
    .join("\n");
  const guarded = `try {\n${scene}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const where = random.pick(["top", "top", "once", "twice", "common"] as const);
  if (where === "top") return { file: "main.mjs", text: `${guarded}\n` };
  if (where === "common") return { file: "main.cjs", text: `(async () => {\n${guarded}\n})();\n` };
  return {
    file: "main.mjs",
    text: `async function run() {\n${guarded}\n}\nawait run();\n${where === "twice" ? "await run();\n" : ""}`,
  };
}
