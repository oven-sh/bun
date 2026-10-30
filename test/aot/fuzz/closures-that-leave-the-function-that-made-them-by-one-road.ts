// Small programs about one function that makes a closure over its own variables and lets it out by one road alone. The function is called twice, other functions run and make things of their own, a
// collection runs, and then both closures are called: each still finds the variables of the call that made it. There is one road in a program, and every line is printed at once, by `console.log`.
//
//   the closure  an arrow, a function, a declared function, an arrow out of an arrow, a bound function, a method taken off a literal, a generator, one over an object, over two variables, over
//                `arguments`, over a variable that is stored to behind its making, over another closure
//   the road     it is thrown, the cause of an error, yielded, the value of an iterator's result, sent into a generator, held by a suspended function; given to a setter; `this` or an argument
//                of a bound function; `this` of `call`, `apply`, `Reflect.apply`; in the `arguments` or the rest of a callee; the value of a tag; a key or a value of a `Map`, `Set`, `WeakMap`; in a
//                `WeakRef`; the target of a proxy; above another object; captured by a closure or a getter; what a constructor answers; stored by a pattern, `Object.assign`,
//                `Object.defineProperty`, `Reflect.set`, a symbol, a private name, methods of lists, `globalThis`; what a built-in copies out of a list or an object; the value or the reason
//                of a promise; an argument of a timer, a tick, an event
//   between      calls that go deep and make objects of their own, many short-lived objects, `Bun.gc(true)`
//   where        the calls in one function and the reads in another, or all at the top; what carries the closure is opened ahead of the collection or behind it
import type { Random } from "./random";

type Road = {
  declares?: string;
  word?: "function*" | "async function";
  leaves: string;
  takes?: (n: number, into: string) => string;
  reaches?: (into: string, index: number) => string;
  waits?: boolean;
};

export function generate(random: Random): { file: string; text: string } {
  const L = "o";
  const [born, called] = random.weighted<[string, (held: string) => string]>([
    [5, ["const o = () => n;", held => `${held}()`]],
    [3, ["const o = function () {\nreturn n;\n};", held => `${held}()`]],
    [2, ["function o() {\nreturn n;\n}", held => `${held}()`]],
    [2, ["const o = () => () => n;", held => `${held}()()`]],
    [2, ["const o = function () {\nreturn this.n;\n}.bind({ n });", held => `${held}()`]],
    [2, ["const o = {\nm() {\nreturn n;\n},\n}.m;", held => `${held}()`]],
    [1, ["const o = function* () {\nyield n;\n};", held => `${held}().next().value`]],
    [3, ['const inside = { n, text: "t" + n };\nconst o = () => inside.n + inside.text;', held => `${held}()`]],
    [2, ['const text = "t" + n;\nconst o = () => n + text;', held => `${held}()`]],
    [1, ["const o = () => arguments[0];", held => `${held}()`]],
    [2, ["let later = 0;\nconst o = () => later;\nlater = n * 10;", held => `${held}()`]],
    [2, ["const inner = () => n;\nconst o = () => inner() + 1;", held => `${held}()`]],
    [1, ["const o = (a => b => a + b)(n);", held => `${held}(100)`]],
    [1, ["let count = n;\nconst o = () => count++;", held => `${held}() + ${held}()`]],
    [1, ["const list = [n, n + 1];\nconst o = index => list[index];", held => `${held}(1)`]],
  ]);

  const throughLast = (declares: string, leaves: string, more: Partial<Road> = {}): Road => ({
    declares: `let last;${declares ? "\n" + declares : ""}`,
    leaves,
    takes: (n, into) => `make(${n});\n${into} = last;`,
    ...more,
  });
  const answered = (leaves: string, reaches?: (into: string) => string, more: Partial<Road> = {}): Road => ({
    leaves,
    reaches,
    ...more,
  });
  const kept = (declares: string, leaves: string, reaches: (index: number) => string): Road => ({
    declares,
    leaves,
    takes: n => `make(${n});`,
    reaches: (_, index) => reaches(index),
  });
  const caught = (leaves: string, reaches?: (into: string) => string): Road => ({
    leaves,
    takes: (n, into) => `try {\nmake(${n});\n} catch (thrown) {\n${into} = thrown;\n}`,
    reaches,
  });
  const later = (leaves: string, wait: string): Road =>
    throughLast("function keep(given) {\nlast = given;\n}", leaves, {
      waits: true,
      takes: (n, into) => `make(${n});\n${wait}\n${into} = last;`,
    });

  const roads: [number, Road][] = [
    [3, caught(`throw ${L};`)],
    [3, caught(`throw new Error("e", { cause: ${L} });`, into => `${into}.cause`)],
    [1, caught(`throw new AggregateError([${L}]);`, into => `${into}.errors[0]`)],
    [1, caught(`throw Object.assign(new Error("e"), { held: ${L} });`, into => `${into}.held`)],
    [
      3,
      answered(`yield ${L};`, undefined, {
        word: "function*",
        takes: (n, into) => `${into} = make(${n}).next().value;`,
      }),
    ],
    [2, answered(`yield ${L};`, undefined, { word: "function*", takes: (n, into) => `[${into}] = make(${n});` })],
    [
      2,
      answered(`yield;\nyield ${L};`, into => `${into}.next().value`, {
        word: "function*",
        takes: (n, into) => `${into} = make(${n});\n${into}.next();`,
      }),
    ],
    [
      1,
      answered(`return ${L};`, undefined, {
        word: "function*",
        takes: (n, into) => `${into} = make(${n}).next().value;`,
      }),
    ],
    [
      2,
      answered(
        `return {\n[Symbol.iterator]() {\nreturn {\nnext() {\nreturn { done: false, value: ${L} };\n},\n};\n},\n};`,
        undefined,
        { takes: (n, into) => `[${into}] = make(${n});` },
      ),
    ],
    [
      3,
      answered(`const it = holds();\nit.next();\nit.next(${L});\nreturn it;`, into => `${into}.next().value`, {
        declares: "function* holds() {\nconst got = yield;\nyield;\nyield got;\n}",
      }),
    ],
    [
      2,
      answered(`await gate;\nreturn ${L};`, into => `(open(), await ${into})`, {
        word: "async function",
        waits: true,
        declares: "let open;\nconst gate = new Promise(resolve => {\nopen = resolve;\n});",
      }),
    ],
    [2, answered(`return ${L};`, into => `await ${into}`, { word: "async function", waits: true })],
    [2, answered(`return Promise.resolve(${L});`, into => `await ${into}`, { waits: true })],
    [1, answered(`return Promise.reject(${L}).catch(reason => reason);`, into => `await ${into}`, { waits: true })],
    [1, answered(`return Promise.all([${L}]);`, into => `(await ${into})[0]`, { waits: true })],
    [1, answered(`return new Promise(resolve => resolve(${L}));`, into => `await ${into}`, { waits: true })],
    [3, throughLast("const sink = {\nset put(given) {\nlast = given;\n},\n};", `sink.put = ${L};`)],
    [1, throughLast("const sink = {\nset put(given) {\nlast = given;\n},\n};", `Object.assign(sink, { put: ${L} });`)],
    [1, throughLast("const sink = {\nset put(given) {\nlast = given;\n},\n};", `({ put: sink.put } = { put: ${L} });`)],
    [3, answered(`return self.bind(${L});`, into => `${into}()`, { declares: "function self() {\nreturn this;\n}" })],
    [
      2,
      answered(`return same.bind(null, ${L});`, into => `${into}()`, {
        declares: "function same(given) {\nreturn given;\n}",
      }),
    ],
    [2, throughLast("function keep() {\nlast = this;\n}", `keep.call(${L});`)],
    [1, throughLast("function keep() {\nlast = this;\n}", `keep.apply(${L});`)],
    [1, throughLast("function keep() {\nlast = this;\n}", `Reflect.apply(keep, ${L}, []);`)],
    [1, throughLast("function keep(given) {\nlast = given;\n}", `keep.apply(null, [${L}]);`)],
    [1, throughLast("function keep(given) {\nlast = given;\n}", `keep(...[${L}]);`)],
    [2, throughLast("function keep() {\nlast = arguments;\n}", `keep(${L});`, { reaches: into => `${into}[0]` })],
    [2, throughLast("function keep(...all) {\nlast = all;\n}", `keep(${L});`, { reaches: into => `${into}[0]` })],
    [1, throughLast("function keep({ held }) {\nlast = held;\n}", `keep({ held: ${L} });`)],
    [1, throughLast("function keep(unused, given = unused) {\nlast = given;\n}", `keep(${L});`)],
    [2, throughLast("function tag(texts, given) {\nlast = given;\n}", `tag\`\${${L}}\`;`)],
    [2, kept("const map = new Map();", `map.set(${L}, n);`, index => `[...map.keys()][${index}]`)],
    [2, kept("const map = new Map();", `map.set(n, ${L});`, index => `map.get(${index + 1})`)],
    [2, kept("const set = new Set();", `set.add(${L});`, index => `[...set][${index}]`)],
    [
      1,
      kept(
        "const weak = new WeakMap();\nconst keys = [{}, {}, {}];",
        `weak.set(keys[n], ${L});`,
        index => `weak.get(keys[${index + 1}])`,
      ),
    ],
    [1, answered(`return new WeakRef(${L});`, undefined, { takes: (n, into) => `${into} = make(${n}).deref();` })],
    [3, answered(`return new Proxy(${L}, {});`)],
    [
      1,
      answered(
        `return new Proxy({}, {\nget: (target, name) => ${L}[name],\nownKeys: () => [],\n});`,
        into => `{ a: ${into}.a, b: ${into}.b, 0: ${into}[0] }`,
      ),
    ],
    [2, answered(`return Object.create(${L});`, into => `Object.getPrototypeOf(${into})`)],
    [2, answered(`return { __proto__: ${L} };`, into => `Object.getPrototypeOf(${into})`)],
    [1, answered(`return Object.setPrototypeOf({}, ${L});`, into => `Object.getPrototypeOf(${into})`)],
    [3, answered(`return () => ${L};`, into => `${into}()`)],
    [1, answered(`return () => () => ${L};`, into => `${into}()()`)],
    [2, answered(`return {\nget it() {\nreturn ${L};\n},\n};`, into => `${into}.it`)],
    [2, answered(`return new (class {\nconstructor() {\nreturn ${L};\n}\n})();`)],
    [1, answered(`return new (function () {\nreturn ${L};\n})();`)],
    [1, answered(`try {\nreturn ${L};\n} finally {\nn++;\n}`)],
    [2, throughLast("", `[last] = [${L}];`)],
    [2, throughLast("", `({ last } = { last: ${L} });`)],
    [1, throughLast("", `for (last of [${L}]);`)],
    [1, throughLast("", `last ??= null;\nlast = ${L};`)],
    [1, throughLast("", `(() => {\nlast = ${L};\n})();`)],
    [1, throughLast("", `[${L}].forEach(each => {\nlast = each;\n});`)],
    [1, throughLast("", `"x".replace("x", () => {\nlast = ${L};\nreturn "";\n});`)],
    [1, throughLast("", `[1, 2].sort(() => {\nlast = ${L};\nreturn 0;\n});`)],
    [1, throughLast("", `JSON.stringify({ k: 1 }, () => {\nlast = ${L};\n});`)],
    [2, kept("const outer = {};", `Object.assign(outer, { ["k" + n]: ${L} });`, index => `outer.k${index + 1}`)],
    [
      2,
      kept(
        "const outer = {};",
        `Object.defineProperty(outer, "k" + n, { value: ${L} });`,
        index => `outer.k${index + 1}`,
      ),
    ],
    [1, kept("const outer = {};", `Reflect.set(outer, "k" + n, ${L});`, index => `outer.k${index + 1}`)],
    [
      1,
      kept(
        "const outer = {};",
        `Reflect.defineProperty(outer, "k" + n, { value: ${L} });`,
        index => `outer.k${index + 1}`,
      ),
    ],
    [1, kept("const outer = {};", `outer["k" + n] = ${L};`, index => `outer.k${index + 1}`)],
    [
      1,
      kept(
        "const outer = {};\nconst keys = [Symbol(), Symbol(), Symbol()];",
        `outer[keys[n]] = ${L};`,
        index => `outer[keys[${index + 1}]]`,
      ),
    ],
    [1, kept("", `globalThis["k" + n] = ${L};`, index => `globalThis.k${index + 1}`)],
    [
      2,
      kept(
        "class Safe {\n#held = [];\nstatic put(safe, given) {\nsafe.#held.push(given);\n}\nstatic take(safe, index) {\nreturn safe.#held[index];\n}\n}\nconst safe = new Safe();",
        `Safe.put(safe, ${L});`,
        index => `Safe.take(safe, ${index})`,
      ),
    ],
    [2, kept("const list = [];", `list.push(${L});`, index => `list[${index}]`)],
    [1, kept("const list = [];", `list[list.length] = ${L};`, index => `list[${index}]`)],
    [1, kept("const list = [];", `list.unshift(${L});`, index => `list.at(-1 - ${index})`)],
    [1, kept("const list = [];", `list.splice(list.length, 0, ${L});`, index => `list[${index}]`)],
    [1, kept("const list = [0, 0, 0];", `list.fill(${L}, n, n + 1);`, index => `list[${index + 1}]`)],
    ...(
      [
        [`[0].map(() => ${L})`, "[0]"],
        [`Array.from({ length: 1 }, () => ${L})`, "[0]"],
        [`Array.of(${L})`, "[0]"],
        [`[${L}].slice()`, "[0]"],
        [`[${L}].concat()`, "[0]"],
        [`[].concat([${L}])`, "[0]"],
        [`[[${L}]].flat()`, "[0]"],
        [`[...[${L}]]`, "[0]"],
        [`Array(1).fill(${L})`, "[0]"],
        [`[${L}].toSorted()`, "[0]"],
        [`[${L}].reverse()`, "[0]"],
        [`[null].with(0, ${L})`, "[0]"],
        [`[${L}].filter(() => true)`, "[0]"],
        [`[${L}].values()`, ".next().value"],
        [`[${L}].entries()`, ".next().value[1]"],
        [`Object.values({ k: ${L} })`, "[0]"],
        [`Object.entries({ k: ${L} })`, "[0][1]"],
        [`Object.fromEntries([["k", ${L}]])`, ".k"],
        [`{ ...{ k: ${L} } }`, ".k"],
        [`Object.assign({}, { k: ${L} })`, ".k"],
        [`new Map([[1, ${L}]])`, ".get(1)"],
        [`new Set([${L}])`, ".values().next().value"],
        [`[${L}].find(() => true)`, ""],
        [`[${L}].at(0)`, ""],
        [`[${L}].pop()`, ""],
        [`[${L}].shift()`, ""],
        [`[${L}].reduce((sum, each) => each, null)`, ""],
        [`Reflect.get({ k: ${L} }, "k")`, ""],
        [`Object.getOwnPropertyDescriptor({ k: ${L} }, "k")`, ".value"],
        [`(null ?? ${L})`, ""],
        [`(n > 0 ? ${L} : null)`, ""],
        [`[${L}, n][0]`, ""],
        [`{ k: ${L} }.k`, ""],
      ] as [string, string][]
    ).map(([made, opened]): [number, Road] => [
      1,
      answered(`return ${made.startsWith("{") ? `(${made})` : made};`, into => `${into}${opened}`),
    ]),
    [2, later(`setTimeout(keep, 0, ${L});`, "await new Promise(resolve => setTimeout(resolve, 2));")],
    [2, later(`setImmediate(keep, ${L});`, "await new Promise(resolve => setTimeout(resolve, 2));")],
    [2, later(`process.nextTick(keep, ${L});`, "await new Promise(resolve => setImmediate(resolve));")],
    [2, later(`queueMicrotask(() => keep(${L}));`, "await null;")],
    [1, later(`Promise.resolve(${L}).then(keep);`, "await null;\nawait null;")],
    [
      1,
      throughLast(
        'const target = new EventTarget();\ntarget.addEventListener("told", event => {\nlast = event.detail;\n});',
        `target.dispatchEvent(new CustomEvent("told", { detail: ${L} }));`,
      ),
    ],
  ];

  const road = random.weighted(roads.filter(([, each]) => !/\[name\]/.test(each.leaves)));
  const takes = road.takes ?? ((n: number, into: string) => `${into} = make(${n});`);
  const reaches = road.reaches ?? ((into: string) => into);
  const make = `${road.word ?? "function"} make(n) {\n${[born, road.leaves].filter(Boolean).join("\n")}\n}`;
  const declared = [road.declares, make].filter(Boolean).join("\n");

  const count = random.pick([1, 2, 2, 2, 3]);
  const names = ["first", "second", "third"].slice(0, count);
  const opensEarly = random.chance(0.4) && !/open\(\)/.test(reaches("x", 0));
  const early = names
    .map(
      (name, index) =>
        takes(index + 1, name) +
        (opensEarly && reaches(name, index) !== name ? `\n${name} = ${reaches(name, index)};` : ""),
    )
    .join("\n");
  const late = names
    .map((name, index) => {
      const reached = opensEarly ? name : reaches(name, index);
      return /^[\w.[\]]+$/.test(reached)
        ? `console.log(${called(reached)});`
        : `{\nconst held = ${reached};\nconsole.log(${called("held")});\n}`;
    })
    .join("\n");
  const between = random
    .sample(
      [
        "churn(30);",
        "churn(30);",
        "Bun.gc(true);",
        "Bun.gc(true);",
        'for (let i = 0; i < 3000; i++) junk = { a: i, b: "j" + i, c: [i] };',
      ],
      random.between(1, 3),
    )
    .sort((a, b) => (a.startsWith("Bun") ? 1 : 0) - (b.startsWith("Bun") ? 1 : 0))
    .filter((each, index, all) => all.indexOf(each) === index)
    .join("\n");
  const helpers = [
    between.includes("churn")
      ? 'function churn(depth) {\nconst filler = { a: -depth, b: "filler" + depth, c: [depth, depth] };\nreturn depth > 0 ? churn(depth - 1) + filler.a : filler.c.length;\n}'
      : "",
    between.includes("junk") ? "let junk;" : "",
  ]
    .filter(Boolean)
    .join("\n");

  const waits = !!road.waits;
  const isModule = random.chance(0.5);
  const file = isModule ? "main.mjs" : "main.cjs";
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error?.constructor.name);\n}`;
  const a = waits ? "async " : "";
  const w = waits ? "await " : "";
  const wrapped = (text: string) => (waits && !isModule ? `(async () => {\n${text}\n})();` : text);
  const head = [declared, helpers, `let ${names.join(", ")};`].filter(Boolean).join("\n");
  if (random.chance(0.7))
    return {
      file,
      text: `${head}\n${a}function early() {\n${early}\n}\n${a}function late() {\n${late}\n}\n${wrapped(guarded(`${w}early();\n${between}\n${w}late();`))}\n`,
    };
  if (random.chance(0.5)) return { file, text: `${head}\n${wrapped(guarded(`${early}\n${between}\n${late}`))}\n` };
  return {
    file,
    text: `${a}function run() {\n${head}\n${guarded(`${early}\n${between}\n${late}`)}\n}\n${waits ? (isModule ? "await run();\nawait run();" : "run().then(run);") : "run();\nrun();"}\n`,
  };
}
