// The programs of awaited-objects. `bun test/aot/generate.ts awaited-objects <where>` writes them.
// One attack a program: a fact about a field belongs to a layout, so within one program a single attack that is seen would hide the others.
// Every program: a base class with two classes below it, a loop that reads fields and calls methods before AND after the attack, one line printed.
import { programsOf, type WrittenProgram } from "../generate";

/** By the path below the folder of programs. */
const filesWritten: Record<string, string> = {};

const CLASSES = `class Body {
  mass: number;
  label: string;
  at = { x: 1 };
  constructor(mass: number, label: string) {
    this.mass = mass;
    this.label = label;
  }
  weight(): number {
    return this.mass * 2;
  }
  name(): string {
    return this.label;
  }@BODY
}

class Heavy extends Body {
  extra = 5;
  weight(): number {
    return this.mass * 3 + this.extra;
  }@HEAVY
}

class Light extends Body {
  lift = 1;
  weight(): number {
    return this.mass - this.lift;
  }@LIGHT
}
`;
const MEASURE = `
function measure(bodies: Body[]): string {
  let total = 0;
  let letters = 0;
  try {
    for (let round = 0; round < 200; round++) {
      for (const body of bodies) {
        total += body.weight() + body.mass + body.at.x;
        letters += body.name().length;
      }
    }
  } catch (error) {
    return (error as Error).name;
  }
  return (typeof total === "number" ? String(total) : typeof total + String(total).length) + "/" + letters;
}

const world: Body[] = [new Heavy(1, "a"), new Light(2, "bb"), new Body(3, "ccc"), new Heavy(4, "d")];
const seen: unknown[] = [measure(world)];
`;
const END = `seen.push(measure(world), world.map(body => Object.keys(body).length).join(""));
console.log(seen.join(" "));
`;
function program(slug: string, head: string, attack: string, { pre = "", body = "", heavy = "", light = "", imports = "", classes = CLASSES, measure = MEASURE, end = END }: Record<string, any> = {}) {
  const indent = text => text ? "\n" + text.replace(/^\n+|\n+$/g, "").split("\n").map(line => line ? "  " + line : "").join("\n") : "";
  let text = "// " + head + "\n" + (imports ? imports.trimEnd() + "\n" : "export {};\n") + "\n";
  if (pre) {
    text += pre.replace(/^\n+|\n+$/g, "") + "\n\n";
  }
  text += classes.replaceAll("@BODY", indent(body)).replaceAll("@HEAVY", indent(heavy)).replaceAll("@LIGHT", indent(light));
  text += measure + attack.replace(/^\n+|\n+$/g, "") + "\n" + end;
  if (slug + ".ts" in filesWritten) throw new Error(slug);
  filesWritten[slug + ".ts"] = text;
}

const CALLS = "let calls = 0;";
const THEN = `let calls = 0;
function then(this: Body, resolve: (value: unknown) => void): void {
  calls++;
  (this as any).mass = "9";
  resolve(calls);
}`;
const METHOD = `then(resolve: (value: unknown) => void): void {
  calls++;
  (this as any).mass = "9";
  resolve(calls);
}`;
const FORMS: [string, string, (x: any) => string][] = [
  ["await", "`await`", x => `await ${x}`],
  ["promise-resolve", "Promise.resolve", x => `await Promise.resolve(${x}).then(value => value)`],
  ["an-async-return", "the return of an async function", x => `await (async () => ${x})()`],
  ["a-resolve-function", "the resolve function of an executor", x => `await new Promise(resolve => resolve(${x}))`],
  ["the-result-of-a-reaction", "what a reaction returns", x => `await Promise.resolve(0).then(() => ${x})`],
  ["a-timer-that-resolves", "a timer that is given a resolve function and the value", x => `await new Promise(resolve => setTimeout(resolve, 0, ${x}))`],
  ["a-tick-that-resolves", "process.nextTick, which is given a resolve function and the value", x => `await new Promise(resolve => process.nextTick(resolve, ${x}))`],
  ["promise-all", "Promise.all", x => `(await Promise.all([${x}]))[0]`],
  ["promise-race", "Promise.race", x => `await Promise.race([${x}])`],
  ["array-from-async", "Array.fromAsync", x => `(await Array.fromAsync([${x}]))[0]`],
  ["a-yield-of-an-async-generator", "the `yield` of an async generator", x => `(await (async function* () {\n  yield ${x};\n})().next()).value`],
  ["with-resolvers", "the resolve function of Promise.withResolvers", x => `await ((made = Promise.withResolvers<unknown>()) => (made.resolve(${x}), made.promise))()`],
];

// 1. real thenables
for (const [slug, words, form] of FORMS) {
  program(
    "thenables-an-own-then-on-one-instance-of-many-seen-by-" + slug,
    "One instance of many has an own `then`. It goes through " + words + ", which calls it, and it stores a string into a number field of its receiver.",
    `(world[1] as any).then = then;\nseen.push((${form("world[0]")}) === world[0], typeof (${form("world[1]")}), calls);`, { pre: THEN },
  );
  program(
    "thenables-then-is-a-method-of-the-class-seen-by-" + slug,
    "One of the two subclasses has a method `then`. An instance goes through " + words + ", which calls the method, and it stores a string into a number field of its receiver.",
    `seen.push((${form("world[1]")}) === world[1], typeof (${form("world[0]")}), calls);`, { pre: CALLS, heavy: METHOD },
  );
}
program(
  "thenables-then-is-a-method-of-the-base-class-only",
  "Only the base class has a method `then`; instances of the two classes below it are awaited, and the method stores a string into a number field of each.",
  "for (const body of [world[0], world[1]]) seen.push(typeof (await body));\nseen.push(calls);", { pre: CALLS, body: METHOD },
);
program(
  "thenables-then-is-a-method-of-one-subclass-and-one-await-sees-all-classes",
  "One `await` in a loop sees instances of all three classes, and only one class has a method `then`.",
  "for (const body of world) seen.push(typeof (await body));\nseen.push(calls);", { pre: CALLS, light: METHOD },
);
program(
  "thenables-then-is-a-getter",
  "`then` is an accessor of the class: `await` runs the getter, and then the function that it answers with, which stores a string into a number field.",
  "seen.push(typeof (await world[0]), calls);", { pre: CALLS, heavy: `get then(): (resolve: (value: unknown) => void) => void {
  calls++;
  return resolve => {
    (this as any).mass = "9";
    resolve(calls);
  };
}` },
);
program(
  "thenables-then-is-a-getter-that-answers-a-function-the-second-time",
  "`then` is an accessor that answers undefined the first time and a function the second time, so the first `await` gives the instance and the second does not.",
  "seen.push((await world[0]) === world[0], measure(world), typeof (await world[0]), calls);", { pre: CALLS, heavy: `get then(): unknown {
  if (++calls < 2) return undefined;
  return (resolve: (value: unknown) => void): void => {
    (this as any).mass = "9";
    resolve(calls);
  };
}` },
);
program(
  "thenables-then-is-inherited-from-an-object-put-above-one-instance",
  "Object.setPrototypeOf puts an object with a `then` between one instance and the prototype object of its class.",
  "Object.setPrototypeOf(world[0], Object.create(Heavy.prototype, { then: { value: then } }));\nseen.push((await world[3]) === world[3], typeof (await world[0]), calls);", { pre: THEN },
);
program(
  "thenables-then-is-inherited-from-an-object-put-above-the-class-prototype",
  "Object.setPrototypeOf puts an object with a `then` between the prototype object of a subclass and that of its base class.",
  "Object.setPrototypeOf(Heavy.prototype, Object.create(Body.prototype, { then: { value: then } }));\nseen.push((await world[1]) === world[1], typeof (await world[0]), calls);", { pre: THEN },
);
program(
  "thenables-then-is-inherited-through-the-proto-setter",
  "A store to `__proto__` puts an object with a `then` above one instance.",
  "(world[0] as any).__proto__ = { __proto__: Heavy.prototype, then };\nseen.push((await world[3]) === world[3], typeof (await world[0]), calls);", { pre: THEN },
);
program(
  "thenables-then-is-answered-by-a-proxy-above-the-base-class",
  "A proxy lies above the prototype object of the base class, and its `get` trap answers a function for the name `then` alone.",
  'Object.setPrototypeOf(Body.prototype, new Proxy({}, { get: (target, key) => (key === "then" ? then : undefined) }));\nseen.push(typeof (await world[2]), calls);', { pre: THEN },
);
program(
  "thenables-then-is-a-field-of-the-class",
  "`then` is a field of one subclass that holds an arrow function, so every instance of that class has an own `then`.",
  "seen.push((await world[1]) === world[1], typeof (await world[0]), calls);", { pre: CALLS, heavy: 'then = (resolve: (value: unknown) => void): void => {\n  calls++;\n  (this as any).mass = "9";\n  resolve(calls);\n};' },
);
program(
  "thenables-the-constructor-gives-some-instances-a-then",
  "The constructor of the base class gives an instance an own `then` only where its first argument is large, so of two instances made by the same `new` expression one is a thenable.",
  'const pair = [1, 50].map(mass => new Light(mass, "p"));\nworld.push(...pair);\nfor (const body of pair) seen.push(typeof (await body));\nseen.push(calls);', { pre: THEN, classes: CLASSES.replaceAll("    this.label = label;\n", "    this.label = label;\n    if (mass > 40) (this as any).then = then;\n") },
);
program(
  "thenables-a-for-await-loop-over-the-instances",
  "A `for await` loop over an array of instances awaits each of them, and one class has a method `then`.",
  "for await (const body of world) seen.push(typeof body);\nseen.push(calls);", { pre: CALLS, light: METHOD },
);
program(
  "thenables-then-is-a-bound-built-in-then",
  "The `then` of a class is the built-in Promise.prototype.then bound to a promise that holds an instance of the other subclass, so that instance comes out of an `await` of the first class.",
  "(Heavy.prototype as any).then = Promise.prototype.then.bind(Promise.resolve(world[1]));\nconst out = (await world[0]) as Heavy;\nseen.push(out instanceof Heavy, out.weight(), out.extra);",
);
program(
  "thenables-then-is-a-scheduler-of-the-host",
  "The `then` of three instances is queueMicrotask, process.nextTick and setTimeout: each calls the resolve function that `await` hands it, with nothing or with the reject function.",
  "(world[0] as any).then = queueMicrotask;\n(world[1] as any).then = process.nextTick;\n(world[2] as any).then = setTimeout;\nfor (const body of world) seen.push(typeof (await body));",
);
program(
  "thenables-then-is-function-prototype-call",
  "The `then` of an instance is Function.prototype.call, which throws a TypeError because its receiver, the instance, is no function; the `await` throws it on.",
  "(world[0] as any).then = Function.prototype.call;\ntry {\n  seen.push(await world[0]);\n} catch (error) {\n  seen.push((error as Error).name);\n}",
);
program(
  "thenables-then-is-no-function",
  "`then` is a number on one instance, an object on another and null on a third: none of them is a thenable, and each comes out of its `await` as it is.",
  "(world[0] as any).then = 5;\n(world[1] as any).then = { call() {} };\n(world[2] as any).then = null;\nfor (const body of world) seen.push((await body) === body);",
);
program(
  "thenables-then-comes-with-a-mixin",
  "A function copies the members of a mixin onto the prototype object of whatever class it is given, and `then` is among them.",
  "mix(Light, { then, other: 1 });\nseen.push((await world[0]) === world[0], typeof (await world[1]), calls);",
  { pre: THEN + "\nfunction mix(target: { prototype: object }, members: Record<string, unknown>): void {\n  for (const key of Object.keys(members)) (target.prototype as any)[key] = members[key];\n}" },
);

// 2. `then` added late
const LATE: [string, string, string][] = [
  ["by-a-plain-store", "a plain store", "(Heavy.prototype as any).then = then;"],
  ["under-a-computed-key", "a store under a key that is put together at run time", '(Heavy.prototype as any)[["th", "en"].join("")] = then;'],
  ["by-define-property", "Object.defineProperty", 'Object.defineProperty(Heavy.prototype, "then", { value: then, configurable: true });'],
  ["by-define-properties", "Object.defineProperties", "Object.defineProperties(Heavy.prototype, { then: { value: then } });"],
  ["by-reflect-define-property", "Reflect.defineProperty", 'Reflect.defineProperty(Heavy.prototype, "then", { value: then });'],
  ["by-object-assign", "Object.assign", "Object.assign(Heavy.prototype, { then });"],
  ["by-reflect-set", "Reflect.set", 'Reflect.set(Heavy.prototype, "then", then);'],
  ["as-a-getter", "Object.defineProperty, as an accessor", 'Object.defineProperty(Heavy.prototype, "then", { get: () => then });'],
  ["to-the-base-class", "a plain store to the base class", "(Body.prototype as any).then = then;"],
  ["to-the-instance", "a plain store to the instance itself", "(world[0] as any).then = then;"],
  ["to-the-instance-under-a-computed-key", "a store to the instance itself under a key that is put together at run time", '(world[0] as any)[["th", "en"].join("")] = then;'],
];
for (const [slug, words, install] of LATE) {
  program(
    "late-then-added-after-the-first-await-" + slug,
    "The first `await` of an instance gives the instance. Then `then` is added by " + words + ", and the second `await` of the same instance calls it.",
    `seen.push((await world[0]) === world[0], measure(world));\n${install}\nseen.push(typeof (await world[0]), calls);`, { pre: THEN },
  );
}
program(
  "late-then-added-between-two-rounds-of-one-await",
  "One `await` in a loop sees the same instance twice, and `then` is added to its class between the two rounds.",
  "for (let round = 0; round < 2; round++) {\n  seen.push(typeof (await world[0]));\n  (Heavy.prototype as any).then = then;\n}\nseen.push(calls);", { pre: THEN },
);
program(
  "late-then-added-inside-the-callback-of-the-first",
  "A reaction gets the instance, adds `then` to its class and returns the instance, which is a thenable by now.",
  "const result = await Promise.resolve(world[0]).then(value => {\n  (Heavy.prototype as any).then = then;\n  return value;\n});\nseen.push(typeof result, calls);", { pre: THEN },
);
program(
  "late-then-added-by-a-timer-while-an-async-function-sleeps",
  "A timer adds `then` to a class while an async function that holds an instance sleeps; what the function returns afterwards is a thenable.",
  "setTimeout(() => void ((Heavy.prototype as any).then = then), 1);\nconst result = await (async (body: Body) => {\n  await new Promise(resolve => setTimeout(resolve, 5));\n  return body;\n})(world[0]);\nseen.push(typeof result, calls);", { pre: THEN },
);
program(
  "late-then-added-to-object-prototype-and-taken-away-again",
  "`then` is added to Object.prototype for the time of one `await`, so an instance of a class that knows nothing of it is a thenable for that long.",
  "seen.push((await world[2]) === world[2]);\n(Object.prototype as any).then = then;\nconst result = await world[2];\ndelete (Object.prototype as any).then;\nseen.push(typeof result, calls > 0, (await world[2]) === world[2]);", { pre: THEN },
);
program(
  "late-then-removed-again-before-the-second-await",
  "A class has a method `then` that is deleted after the first `await`, so the second `await` gives the instance.",
  "seen.push(typeof (await world[0]), calls);\ndelete (Heavy.prototype as any).then;\nseen.push((await world[0]) === world[0], calls);", { pre: CALLS, heavy: METHOD },
);

// 3. what a `then` does to its receiver
function thenDoes(slug: string, head: string, statements: string, attack = "seen.push(typeof (await world[0]), calls);", pre = CALLS) {
  program("then-writes-" + slug, head, attack, { pre, heavy: "then(resolve: (value: unknown) => void, reject: (reason: unknown) => void): void {\n  calls++;\n" + statements.split("\n").map(line => "  " + line).join("\n") + "\n}" });
}
thenDoes("null-into-an-object-field", "The `then` of a class stores null into a field of its receiver that holds an object everywhere else.", "(this as any).at = null;\nresolve(calls);");
thenDoes("an-object-of-another-shape-into-an-object-field", "The `then` of a class stores an object of another shape into a field of its receiver: the inner field is a string there.", '(this as any).at = { y: 0, x: "7" };\nresolve(calls);');
thenDoes("a-number-into-a-string-field", "The `then` of a class stores a number into a string field of its receiver, so `length` is undefined afterwards.", "(this as any).label = 5;\nresolve(calls);");
thenDoes("and-deletes-a-field", "The `then` of a class deletes a field of its receiver.", "delete (this as any).mass;\nresolve(calls);");
thenDoes("and-adds-a-field", "The `then` of a class adds a property to its receiver that shadows a method of the class.", '(this as any).weight = () => "w";\nresolve(calls);');
thenDoes("and-changes-the-prototype-of-its-receiver", "The `then` of a class puts its receiver under the other subclass, so the methods of that class are found afterwards.", "Object.setPrototypeOf(this, Light.prototype);\nresolve(calls);");
thenDoes("and-turns-a-field-into-an-accessor", "The `then` of a class redefines a field of its receiver as an accessor that answers a string.", 'Object.defineProperty(this, "mass", { get: () => "3", configurable: true, enumerable: true });\nresolve(calls);');
thenDoes(
  "and-freezes-its-receiver", "The `then` of a class freezes its receiver, so a later store throws a TypeError.", "Object.freeze(this);\nresolve(calls);",
  "seen.push(typeof (await world[0]), calls);\ntry {\n  world[0].mass = 8;\n} catch (error) {\n  seen.push((error as Error).name);\n}",
);
thenDoes("to-another-instance", "The `then` of a class stores a string into a number field of another instance, which was never awaited.", '(world[3] as any).mass = "9";\nresolve(calls);');
thenDoes("to-an-instance-of-the-other-subclass", "The `then` of one subclass stores a string into a number field of an instance of the other subclass.", '(world[1] as any).lift = "x";\nresolve(calls);');
thenDoes("a-method-of-its-class", "The `then` of a class replaces a method on the prototype object of the class with one that answers a string.", '(Heavy.prototype as any).weight = () => "w";\nresolve(calls);');
thenDoes("and-resolves-with-its-receiver", "The `then` of a class resolves with its receiver twice, which calls it again each time, and with a number the third time.", "this.mass += 10;\nresolve(calls < 3 ? this : calls);");
thenDoes(
  "and-resolves-with-another-instance", "The `then` of a class resolves with an instance of the other subclass, so that is what comes out of an `await` of the first class.", "resolve(world[1]);",
  "const out = (await world[0]) as unknown as Heavy;\nseen.push(out instanceof Heavy, out.weight(), out.extra, calls);",
);
thenDoes(
  "and-resolves-with-a-look-alike", "The `then` of a class resolves with a plain object that has the fields of the class with other types.", 'resolve({ mass: "5", label: 7, extra: null, at: { x: "x" }, weight: () => "w" });',
  "const out = (await world[0]) as unknown as Heavy;\nseen.push(out instanceof Heavy, out.weight(), out.mass + 1, out.extra, out.at.x + 1, calls);",
);
thenDoes(
  "and-resolves-the-promise-with-itself", "The `then` of a class resolves the promise that waits for it with that very promise, which rejects it with a TypeError.", '(this as any).mass = "9";\nresolve(waiting);',
  'waiting = Promise.resolve(0).then(() => world[0]);\nseen.push(await waiting.then(() => "fulfilled", error => (error as Error).name), calls);', CALLS + "\nlet waiting: Promise<unknown>;",
);
thenDoes("and-resolves-twice", "The `then` of a class resolves twice, with values of two types; only the first counts.", 'resolve("first");\n(this as any).mass = "9";\nresolve(2);', "seen.push(await world[0], calls);");
thenDoes("and-throws-after-it-has-resolved", "The `then` of a class throws after it has resolved, which nobody sees; what it stored before the throw stays.", '(this as any).mass = "9";\nresolve(calls);\nthrow new Error("late");');
thenDoes(
  "and-throws-its-receiver", "The `then` of a class throws its receiver, so the `await` throws an instance, and the catch clause stores a string into a number field of what it caught.", "throw this;",
  'try {\n  await world[0];\n} catch (caught) {\n  (caught as any).mass = "9";\n  seen.push(caught === world[0], calls);\n}',
);
thenDoes(
  "and-rejects-with-its-receiver", "The `then` of a class rejects with its receiver, and the catch clause around the `await` stores a string into a number field of what it caught.", "reject(this);",
  'try {\n  await world[0];\n} catch (caught) {\n  (caught as any).mass = "9";\n  seen.push(caught === world[0], calls);\n}',
);
thenDoes("and-resolves-from-a-timer", "The `then` of a class keeps the resolve function and a timer calls it later, after it has stored a string into a number field of the receiver.", 'setTimeout(() => {\n  (this as any).mass = "9";\n  resolve(calls);\n}, 1);');

// 5. mixed sets
program(
  "mixed-one-await-sees-a-promise-or-an-instance",
  "One `await` sees a promise of an instance in one round and an instance in the next; what comes out is used with its fields and methods, and one promise holds a look-alike.",
  'const alike: any = { mass: "5", label: 7, at: { x: "x" }, weight: () => "w", name: () => [1, 2] };\nfor (let round = 0; round < 4; round++) {\n  const body: Body = await (round % 2 ? Promise.resolve<Body>(round === 3 ? alike : world[1]) : world[round]);\n  seen.push(body.weight() + body.mass + body.at.x, body.name().length);\n}',
);
program(
  "mixed-handlers-answer-with-an-instance-or-a-promise-of-one",
  "Handlers in an array answer with an instance, a promise of one, an async result or a thenable; one loop awaits them all and uses what comes out.",
  'const handlers: (() => Body | Promise<Body>)[] = [\n  () => world[0],\n  () => Promise.resolve(world[1]),\n  async () => world[2],\n  () => ({ then: (resolve: (value: unknown) => void) => resolve({ mass: "5", label: "zz", at: { x: 2 }, weight: () => 1, name: () => "n" }) }) as any,\n  () => new Promise(resolve => setTimeout(resolve, 1, world[3])),\n];\nfor (const handler of handlers) {\n  const body = await handler();\n  seen.push(body.weight() + body.mass + body.at.x, body.name().length, body instanceof Body);\n}',
);
const MIX = 'const thenable: any = { then: (resolve: (value: unknown) => void) => resolve({ mass: "5", label: "zz", at: { x: 2 }, weight: () => 1, name: () => "n" }) };\nconst mixed: any[] = [world[0], Promise.resolve(world[1]), thenable, 7, "text", null, (async () => world[3])()];\nconst use = (body: Body): string => (body instanceof Body || (typeof body === "object" && body !== null) ? body.weight() + body.mass + body.at.x + body.name() : typeof body);\n';
program(
  "mixed-promise-all-over-instances-promises-thenables-and-primitives", "Promise.all gets an array that mixes instances, promises, a thenable and primitives; every value that comes out is used as the type says.",
  MIX + "seen.push(((await Promise.all(mixed)) as Body[]).map(use).join());",
);
program(
  "mixed-promise-all-settled-over-instances-promises-thenables-and-primitives", "Promise.allSettled gets an array that mixes instances, promises, a thenable, primitives and a rejection with an instance; every value and reason that comes out is used as the type says.",
  MIX + 'mixed.push(Promise.reject(world[2]));\nseen.push((await Promise.allSettled(mixed)).map(outcome => use(outcome.status === "fulfilled" ? outcome.value : outcome.reason)).join());',
);
program(
  "mixed-promise-race-over-instances-promises-and-thenables", "Promise.race gets arrays in which an instance, a promise, a thenable or a primitive comes first; the winner is used as the type says.",
  MIX + "for (let first = 0; first < 5; first++) seen.push(use((await Promise.race(mixed.slice(first))) as Body));",
);
program(
  "mixed-promise-any-over-instances-promises-and-thenables", "Promise.any gets arrays that start with rejections, one of them with an instance; the winner, and the reasons where nobody wins, are used as the type says.",
  MIX + "seen.push(use((await Promise.any([Promise.reject(1), thenable, world[0]])) as Body), use((await Promise.any([Promise.reject(world[2]), world[1]])) as Body));\nseen.push(await Promise.any([Promise.reject(world[2]), Promise.reject(5)]).catch(error => (error.errors as Body[]).map(use).join()));",
);

// 6. a promise as a container
let ALIKE = `
class Gauge {
  value = 1;
  unit = "m";
  read(): number {
    return this.value + 1;
  }
}

class Caption {
  value = "one";
  unit = 5;
  read(): string {
    return this.value + "!";
  }
}
`;
const BOXES: [string, string, string][] = [
  ["promise-resolve", "Promise.resolve", "function box(item: unknown): Promise<unknown> {\n  return Promise.resolve(item);\n}"],
  ["a-resolve-function", "the resolve function of an executor", "function box(item: unknown): Promise<unknown> {\n  return new Promise(resolve => resolve(item));\n}"],
  ["an-async-return", "the return of an async function", "async function box(item: unknown): Promise<unknown> {\n  return item;\n}"],
  ["the-result-of-a-reaction", "what a reaction returns", "function box(item: unknown): Promise<unknown> {\n  return Promise.resolve().then(() => item);\n}"],
  ["with-resolvers", "Promise.withResolvers", "function box(item: unknown): Promise<unknown> {\n  const { promise, resolve } = Promise.withResolvers<unknown>();\n  resolve(item);\n  return promise;\n}"],
  ["a-timer-that-resolves", "a timer that is given the resolve function and the value", "function box(item: unknown): Promise<unknown> {\n  return new Promise(resolve => setTimeout(resolve, 0, item));\n}"],
  ["promise-all", "Promise.all", "function box(item: unknown): Promise<unknown> {\n  return Promise.all([item]).then(([first]) => first);\n}"],
];
for (const [slug, words, box] of BOXES) {
  program(
    "containers-two-classes-go-through-one-helper-with-" + slug,
    "One helper puts a value into a promise with " + words + ". An instance of one class goes in at one place and an instance of a class with the same field names and other types at another, and both come out under the type of the first.",
    'const first = (await box(new Gauge())) as Gauge;\nconst second = (await box(new Caption())) as Gauge;\nseen.push(first.value + 1, first.read(), first.unit.length, second.value + 1, second.read(), second.unit.length);\nfor (const item of [new Gauge(), new Caption()]) await box(item).then(out => seen.push((out as Gauge).value + 1, (out as Gauge).read()));\nawait box(world[0]).then(body => void ((body as any).mass = "9"));',
    { pre: box, classes: CLASSES + ALIKE },
  );
}

// 7. rejections
const WRITE = '(caught as any).mass = "9";';
const REJECTIONS: [string, string, string][] = [
  ["promise-reject-and-catch", "Promise.reject is given an instance, and the function given to `catch`", `await Promise.reject(world[0]).catch(caught => {\n  ${WRITE}\n});`],
  ["promise-reject-and-the-second-argument-of-then", "Promise.reject is given an instance, and the second function given to `then`", `await Promise.reject(world[0]).then(undefined, caught => {\n  ${WRITE}\n});`],
  ["promise-reject-and-a-catch-clause-around-await", "Promise.reject is given an instance, and the catch clause around the `await`", `try {\n  await Promise.reject(world[0]);\n} catch (caught) {\n  ${WRITE}\n}`],
  ["a-throw-in-an-async-function", "An async function throws an instance, and the catch clause around the `await` of its result", `try {\n  await (async () => {\n    throw world[0];\n  })();\n} catch (caught) {\n  ${WRITE}\n}`],
  ["a-throw-behind-an-await-in-an-async-function", "An async function throws an instance after an `await`, and the catch clause of its caller's caller", `const inner = async (): Promise<void> => {\n  await null;\n  throw world[0];\n};\nconst outer = async (): Promise<void> => await inner();\ntry {\n  await outer();\n} catch (caught) {\n  ${WRITE}\n}`],
  ["the-reject-function-of-an-executor", "The reject function of an executor is given an instance, and the function given to `catch`", `await new Promise((resolve, reject) => reject(world[0])).catch(caught => {\n  ${WRITE}\n});`],
  ["a-throw-in-an-executor", "An executor throws an instance, and the function given to `catch`", `await new Promise(() => {\n  throw world[0];\n}).catch(caught => {\n  ${WRITE}\n});`],
  ["a-throw-in-a-reaction", "A reaction throws an instance, and the function given to `catch` two links further down", `await Promise.resolve()\n  .then(() => {\n    throw world[0];\n  })\n  .finally(() => {})\n  .catch(caught => {\n    ${WRITE}\n  });`],
  ["the-reason-of-all-settled", "Promise.allSettled keeps an instance as a reason, and whoever reads the reason", `for (const outcome of await Promise.allSettled([Promise.reject(world[0])])) {\n  const caught = outcome.status === "rejected" ? outcome.reason : undefined;\n  ${WRITE}\n}`],
  ["the-errors-of-promise-any", "Promise.any collects an instance among its errors, and whoever reads them", `await Promise.any([Promise.reject(world[0])]).catch(error => {\n  const caught = error.errors[0];\n  ${WRITE}\n});`],
  ["an-async-generator", "An async generator throws an instance, and the catch clause around the `for await` loop", `try {\n  for await (const one of (async function* () {\n    yield 1;\n    throw world[0];\n  })()) seen.push(one);\n} catch (caught) {\n  ${WRITE}\n}`],
  ["an-unhandled-rejection-listener", 'Nobody handles a rejection with an instance, and the "unhandledRejection" listener of the process', `process.on("unhandledRejection", caught => {\n  ${WRITE}\n});\nPromise.reject(world[0]);\nawait new Promise(resolve => setTimeout(resolve, 5));`],
  ["an-uncaught-exception-listener", 'A timer throws an instance, and the "uncaughtException" listener of the process', `process.on("uncaughtException", caught => {\n  ${WRITE}\n});\nsetTimeout(() => {\n  throw world[0];\n}, 1);\nawait new Promise(resolve => setTimeout(resolve, 5));`],
];
for (const [slug, words, attack] of REJECTIONS) {
  program("rejections-" + slug, words + " stores a string into a number field of what it gets.", attack);
}

// 8. schedulers
const SCHEDULERS: [string, string, (f: any, args: any) => string][] = [
  ["next-tick", "process.nextTick", (f, args) => `process.nextTick(${[f, ...args].join(", ")});`],
  ["set-timeout", "setTimeout", (f, args) => `setTimeout(${[f + " as any", "0", ...args].join(", ")});`],
  ["set-immediate", "setImmediate", (f, args) => `setImmediate(${[f + " as any", ...args].join(", ")});`],
];
const WAIT = "await new Promise(resolve => setTimeout(resolve, 5));";
for (const [slug, words, schedule] of SCHEDULERS) {
  program(
    `schedulers-${slug}-passes-a-string-where-direct-calls-pass-a-number`,
    "A function adds its second argument to a field of its first. Every direct call passes a number; " + words + " passes on a string.",
    `grow(world[0], 1);\n${schedule("grow", ["world[0]", '"2"'])}\n${WAIT}`, { pre: "function grow(body: Body, amount: number): void {\n  body.mass += amount;\n}" },
  );
  program(
    `schedulers-${slug}-passes-a-look-alike-where-direct-calls-pass-an-instance`,
    "A function reads fields and calls a method of its argument. Every direct call passes an instance; " + words + " passes on a plain object with the same names and other types.",
    `weigh(world[0]);\n${schedule("weigh", ['{ mass: "5", at: { x: "x" }, weight: () => "w" }'])}\n${WAIT}`, { pre: "function weigh(body: Body): void {\n  seen.push(body.weight() + body.mass + body.at.x);\n}" },
  );
  program(
    `schedulers-${slug}-passes-an-instance-that-the-function-writes-to`,
    words + " passes an instance on to a function that nothing else calls, and the function stores a string into a number field of it.",
    `${schedule("spoil", ["world[0]"])}\n${WAIT}`, { pre: 'function spoil(body: any): void {\n  body.mass = "9";\n}' },
  );
  program(
    `schedulers-${slug}-passes-from-no-argument-to-six`,
    "Seven functions with six number parameters each, which direct calls fill with numbers; " + words + " passes the first none, the second one string, and so on up to six. Each function tells how many strings and how many undefined it saw.",
    Array.from({ length: 7 }, (_, index) => index).map(n => `take${n}(1, 2, 3, 4, 5, 6);\n${schedule(`take${n}`, Array.from({ length: n }, () => ['"s"']).flat())}`).join("\n") + "\n" + WAIT,
    { pre: 'const tell = (index: number, strings: number, missing: number): void => void (strings + missing && seen.push(index + ":" + strings + ":" + missing));\n' + Array.from({ length: 7 }, (_, index) => index).map(n => `function take${n}(a: number, b: number, c: number, d: number, e: number, f: number): void {\n  tell(${n}, +(typeof a === "string") + +(typeof b === "string") + +(typeof c === "string") + +(typeof d === "string") + +(typeof e === "string") + +(typeof f === "string"), +(a === undefined) + +(b === undefined) + +(c === undefined) + +(d === undefined) + +(e === undefined) + +(f === undefined));\n}`).join("\n") },
  );
  program(
    `schedulers-${slug}-calls-a-function-that-reads-arguments`,
    "A function reads `arguments`. Direct calls pass two numbers; " + words + " passes an instance, a string and null, and the function stores into the instance.",
    `gather(1, 2);\n${schedule("gather", ["world[0]", '"s"', "null"])}\n${WAIT}`,
    { pre: 'function gather(first: number, second: number): void {\n  const kinds: string[] = [];\n  for (let index = 0; index < arguments.length; index++) {\n    kinds.push(typeof arguments[index]);\n    if (arguments[index] instanceof Body) arguments[index].mass = "9";\n  }\n  seen.push(kinds.join("+"), typeof first, typeof second);\n}' },
  );
  program(
    `schedulers-${slug}-runs-after-the-object-was-changed`,
    "An instance is handed to " + words + ", and a string is stored into a number field of it between the scheduling and the run; the function reads the field as a number.",
    `${schedule("read", ["world[0]"])}\n(world[0] as any).mass = "9";\n${WAIT}`, { pre: "function read(body: Body): void {\n  seen.push(body.mass + 1, body.weight());\n}" },
  );
}
program(
  "schedulers-a-tick-is-scheduled-inside-a-tick",
  "A function schedules itself with process.nextTick three times, and hands on an instance and a counter that turns into a string on the way; at the end it stores the counter into a number field.",
  "step(world[0], 0);\n" + WAIT, { pre: 'function step(body: Body, depth: number): void {\n  if (typeof depth === "number" && depth < 2) return void process.nextTick(step, body, depth + 1);\n  if (typeof depth === "number") return void process.nextTick(step, body, String(depth));\n  body.mass = depth;\n}' },
);
program(
  "schedulers-queue-microtask-calls-without-an-argument",
  "A function whose direct calls pass an instance is handed to queueMicrotask, which passes nothing; it falls back to an instance out of a variable and stores a string into a number field of it.",
  "touch(world[1]);\nqueueMicrotask(touch as () => void);\n" + WAIT, { pre: 'function touch(body: Body): void {\n  if (body === undefined) (world[0] as any).mass = "9";\n  else body.mass += 1;\n}' },
);
program(
  "schedulers-set-interval-passes-its-arguments-every-time",
  "setInterval passes an instance and a string on to a function, three times; every direct call passes a number.",
  'grow(world[0], 1);\nlet rounds = 0;\nawait new Promise<void>(resolve => {\n  const timer = setInterval(\n    (body: Body, amount: number) => {\n      grow(body, amount);\n      if (++rounds === 3) resolve(clearInterval(timer));\n    },\n    1,\n    world[0],\n    "2" as any,\n  );\n});', { pre: "function grow(body: Body, amount: number): void {\n  body.mass += amount;\n}" },
);
program(
  "schedulers-a-method-is-scheduled-without-its-receiver",
  "A method is taken off an instance and handed to process.nextTick, setTimeout and queueMicrotask, which call it without a receiver; direct calls go through instances.",
  "process.nextTick(world[0].tell);\nsetTimeout(world[1].tell, 0);\nqueueMicrotask(world[2].tell);\nworld[3].tell();\n" + WAIT, { body: 'tell(): void {\n  seen.push(this === undefined ? "none" : this.mass);\n}' },
);
program(
  "schedulers-a-bound-method-is-scheduled-with-another-receiver",
  "A method is bound to a plain object with the same field names and other types and handed to process.nextTick and setTimeout; direct calls go through instances.",
  'const alike: any = { mass: "5", extra: "e" };\nprocess.nextTick(world[0].weight.bind(alike));\nsetTimeout(() => seen.push(world[0].weight.call(alike)), 0);\nprocess.nextTick((run: () => unknown) => seen.push(run()), world[0].weight.bind(alike));\n' + WAIT,
);

// 9. proxies
const THROUGH: [string, string, string][] = [
  ["a-store-of-another-type", "a string is stored into a number field", '(proxy as any).mass = "9";'],
  ["a-store-of-a-new-property", "a property is added that shadows a method of the class", '(proxy as any).weight = () => "w";'],
  ["a-delete", "a field is deleted", "delete (proxy as any).mass;"],
  ["define-property", "a field is redefined as an accessor that answers a string", 'Object.defineProperty(proxy, "mass", { get: () => "3", configurable: true, enumerable: true });'],
  ["set-prototype-of", "the object is put under the other subclass", "Object.setPrototypeOf(proxy, Light.prototype);"],
  ["prevent-extensions", "the object is made non-extensible, so a later store of a new property throws", "Object.preventExtensions(proxy);\ntry {\n  (world[0] as any).fresh = 1;\n} catch (error) {\n  seen.push((error as Error).name);\n}"],
  ["freeze", "the object is frozen, so a later store throws", "Object.freeze(proxy);\ntry {\n  world[0].mass = 8;\n} catch (error) {\n  seen.push((error as Error).name);\n}"],
  ["object-assign", "Object.assign stores strings into number fields", 'Object.assign(proxy, { mass: "9", extra: "e" });'],
  ["reflect-set", "Reflect.set stores a string into a number field", 'Reflect.set(proxy, "mass", "9");'],
  ["a-method-call", "a method of the class that stores into `this` runs with the proxy as its receiver", "(proxy as any).spoil();"],
];
for (const [slug, words, attack] of THROUGH) {
  program(
    "proxies-an-empty-handler-lets-through-" + slug,
    "A proxy with an empty handler stands in front of an instance. Through the proxy " + words + "; the loop afterwards runs on the instance itself.",
    "const proxy = new Proxy(world[0], {});\n" + attack, { body: attack.includes("spoil") ? 'spoil(): void {\n  (this as any).mass = "9";\n}' : "" },
  );
}
const SPOIL = '(target as any).mass = "9";';
const TRAPS: [string, string, string][] = [
  ["get", "get(target, key, receiver) {\n    %s\n    return Reflect.get(target, key, receiver);\n  }", "seen.push(proxy.label);"],
  ["set", "set(target, key, value, receiver) {\n    %s\n    return Reflect.set(target, key, value, receiver);\n  }", 'proxy.label = "z";'],
  ["has", "has(target, key) {\n    %s\n    return Reflect.has(target, key);\n  }", 'seen.push("label" in proxy);'],
  ["delete-property", "deleteProperty(target, key) {\n    %s\n    return true;\n  }", "seen.push(delete (proxy as any).nothing);"],
  ["own-keys", "ownKeys(target) {\n    %s\n    return Reflect.ownKeys(target);\n  }", "seen.push(Object.keys(proxy).length);"],
  ["get-own-property-descriptor", "getOwnPropertyDescriptor(target, key) {\n    %s\n    return Reflect.getOwnPropertyDescriptor(target, key);\n  }", 'seen.push(Object.hasOwn(proxy, "label"));'],
  ["define-property", "defineProperty(target, key, descriptor) {\n    %s\n    return Reflect.defineProperty(target, key, descriptor);\n  }", 'Object.defineProperty(proxy, "label", { value: "z" });'],
  ["get-prototype-of", "getPrototypeOf(target) {\n    %s\n    return Reflect.getPrototypeOf(target);\n  }", "seen.push(proxy instanceof Heavy);"],
  ["set-prototype-of", "setPrototypeOf(target, prototype) {\n    %s\n    return Reflect.setPrototypeOf(target, prototype);\n  }", "Object.setPrototypeOf(proxy, Heavy.prototype);"],
  ["is-extensible", "isExtensible(target) {\n    %s\n    return Reflect.isExtensible(target);\n  }", "seen.push(Object.isExtensible(proxy));"],
  ["prevent-extensions", "preventExtensions(target) {\n    %s\n    return Reflect.preventExtensions(target);\n  }", "Object.preventExtensions(proxy);"],
];
for (const [slug, trap, use] of TRAPS) {
  program(
    `proxies-the-trap-${slug}-writes-to-the-target`,
    `The \`${trap.split("(")[0]}\` trap of a proxy in front of an instance stores a string into a number field of its target; the loop afterwards runs on the instance itself.`,
    `const proxy = new Proxy(world[0], {\n  ${trap.replace("%s", SPOIL)},\n});\n${use}`,
  );
}
program(
  "proxies-the-trap-apply-writes-to-an-argument",
  "The `apply` trap of a proxy in front of a function stores a string into a number field of the instance that the call passes.",
  'const weigh = (body: Body): number => body.weight();\nconst proxy = new Proxy(weigh, {\n  apply(target, receiver, list) {\n    list[0].mass = "9";\n    return Reflect.apply(target, receiver, list);\n  },\n});\nseen.push(weigh(world[3]), proxy(world[0]));',
);
program(
  "proxies-the-trap-construct-writes-to-what-it-made",
  "The `construct` trap of a proxy in front of a class stores a string into a number field of the new instance, which then joins the others in the loop.",
  'const Made = new Proxy(Heavy, {\n  construct(target, list, newTarget) {\n    const made = Reflect.construct(target, list, newTarget);\n    made.mass = "9";\n    return made;\n  },\n});\nworld.push(new Made(5, "e"));\nseen.push(world[4] instanceof Heavy);',
);
program(
  "proxies-the-trap-construct-answers-with-another-class",
  "The `construct` trap of a proxy in front of one subclass answers with an instance of the other, under the type of the first.",
  'const Made = new Proxy(Heavy, {\n  construct(target, list) {\n    return new Light(list[0], list[1]);\n  },\n});\nconst made = new Made(5, "e");\nworld.push(made);\nseen.push(made instanceof Heavy, made.extra, made.weight());',
);
program(
  "proxies-traps-are-added-after-the-proxy-was-made",
  "The handler is empty when the proxy is made. A `get` trap that stores a string into a number field of the target is added to it afterwards.",
  `const handler: ProxyHandler<Body> = {};\nconst proxy = new Proxy(world[0], handler);\nseen.push(proxy.label, measure(world));\nhandler.get = (target, key, receiver) => {\n  ${SPOIL}\n  return Reflect.get(target, key, receiver);\n};\nseen.push(proxy.label);`,
);
program(
  "proxies-traps-are-added-under-a-computed-key",
  "The handler is empty when the proxy is made. A trap is added to it afterwards under a name that is put together at run time.",
  `const handler: any = {};\nconst proxy = new Proxy(world[0], handler);\nseen.push(proxy.label);\nhandler[["g", "et"].join("")] = (target: Body, key: string, receiver: unknown): unknown => {\n  ${SPOIL}\n  return Reflect.get(target, key, receiver);\n};\nseen.push(proxy.label);`,
);
program(
  "proxies-the-handler-is-itself-a-proxy",
  "The handler of a proxy is a proxy whose `get` trap answers every trap that is asked for with a function that stores a string into a number field of the target.",
  `const handler = new Proxy({}, {\n  get: (nothing, trap) => (target: Body, ...rest: unknown[]) => {\n    ${SPOIL}\n    return (Reflect as any)[trap](target, ...rest);\n  },\n});\nconst proxy = new Proxy(world[0], handler);\nseen.push(proxy.label);`,
);
program(
  "proxies-the-handler-inherits-its-traps",
  "The handler of a proxy is an instance of a class, and the trap is a method of that class.",
  `class Handler implements ProxyHandler<Body> {\n  get(target: Body, key: string | symbol, receiver: unknown): unknown {\n    ${SPOIL}\n    return Reflect.get(target, key, receiver);\n  }\n}\nconst proxy = new Proxy(world[0], new Handler());\nseen.push(proxy.label);`,
);
program(
  "proxies-a-revocable-proxy-writes-and-is-revoked",
  "A string is stored into a number field through a revocable proxy, which is then revoked, so that every further use of it throws a TypeError.",
  'const { proxy, revoke } = Proxy.revocable(world[0], {});\n(proxy as any).mass = "9";\nrevoke();\ntry {\n  seen.push(proxy.label);\n} catch (error) {\n  seen.push((error as Error).name);\n}',
);
program(
  "proxies-a-proxy-above-the-base-class-sees-reads-of-missing-names",
  "A proxy lies above the prototype object of the base class. A read of a name that no class has reaches its `get` trap with the instance as the receiver, and the trap stores a string into a number field of it.",
  'Object.setPrototypeOf(Body.prototype, new Proxy({}, {\n  get(target, key, receiver) {\n    if (key === "missing") receiver.mass = "9";\n    return undefined;\n  },\n}));\nseen.push(measure(world), (world[0] as any).missing);',
);
program(
  "proxies-a-proxy-above-the-base-class-sees-stores-of-new-names",
  "A proxy lies above the prototype object of the base class. A store of a new property on an instance reaches its `set` trap with the instance as the receiver, and the trap stores a string into a number field instead.",
  'Object.setPrototypeOf(Body.prototype, new Proxy({}, {\n  set(target, key, value, receiver) {\n    return Reflect.defineProperty(receiver, "mass", { value: String(value), writable: true, enumerable: true, configurable: true });\n  },\n}));\nseen.push(measure(world));\n(world[0] as any).fresh = 9;',
);
program(
  "proxies-a-proxy-above-the-base-class-sees-the-in-operator",
  "A proxy lies above the prototype object of the base class. The `in` operator with a name that no class has reaches its `has` trap, which stores a string into a number field of an instance out of a variable.",
  'Object.setPrototypeOf(Body.prototype, new Proxy({}, {\n  has(target, key) {\n    (world[0] as any).mass = "9";\n    return false;\n  },\n}));\nseen.push(measure(world), "missing" in world[1]);',
);
program(
  "proxies-a-proxy-stands-among-the-instances",
  "A proxy in front of an instance joins the instances in the loop, under their type: methods run with the proxy as their receiver, and its `get` trap answers a string for one field.",
  'world.push(new Proxy(new Heavy(5, "e"), {\n  get: (target, key, receiver) => (key === "mass" ? "5" : Reflect.get(target, key, receiver)),\n}));',
);
for (const [slug, words, form] of FORMS) {
  program(
    "proxies-a-proxy-is-seen-by-" + slug,
    "A proxy in front of an instance goes through " + words + ": its `get` trap is asked for `then`, and stores a string into a number field of the target at that moment.",
    `let asked = 0;\nconst proxy = new Proxy(world[0], {\n  get(target, key, receiver) {\n    if (key === "then") {\n      asked++;\n      ${SPOIL}\n    }\n    return Reflect.get(target, key, receiver);\n  },\n});\nseen.push((${form("proxy")}) === proxy, asked);`,
  );
}
program(
  "proxies-a-proxy-with-an-empty-handler-is-awaited-and-written-through",
  "A proxy with an empty handler in front of an instance is awaited; a string is stored into a number field through what comes out.",
  'const out = await new Proxy(world[0], {});\n(out as any).mass = "9";\nseen.push(out === world[0], out instanceof Heavy);',
);
program(
  "proxies-a-proxy-answers-a-then-of-its-own",
  "The `get` trap of a proxy in front of an instance answers a function for `then`, so the proxy is a thenable though its target is not; the function resolves with the target after it has stored into it.",
  `const proxy = new Proxy(world[0], {\n  get(target, key, receiver) {\n    if (key !== "then") return Reflect.get(target, key, receiver);\n    return (resolve: (value: unknown) => void): void => {\n      ${SPOIL}\n      resolve(target);\n    };\n  },\n});\nseen.push((await proxy) === world[0]);`,
);

// The build refuses a store to a built-in prototype object that it can see, so this attack cannot be made: the file beside the program says what the build must print.
filesWritten["late-then-added-to-object-prototype-and-taken-away-again.build-errors.txt"] = "error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable\n";
// SUBCLASSES OF PROMISE.
const TRACKED = `let made = 0;

class Tracked extends Promise<number> {
  hits = 0;
  tag = "t";
  constructor(executor: (resolve: (value: number) => void, reject: (reason: unknown) => void) => void) {
    super(executor);
    made++;
  }
  bump(): number {
    return ++this.hits;
  }@BODY
}

class Fast extends Tracked {
  speed = 2;
  bump(): number {
    return (this.hits += this.speed);
  }@HEAVY
}

class Slow extends Tracked {
  delay = "d";
  bump(): number {
    return this.hits + this.delay.length;
  }@LIGHT
}
`;
const TRACKED_MEASURE = `
function measure(list: Tracked[]): string {
  let total = 0;
  let letters = 0;
  try {
    for (let round = 0; round < 200; round++) {
      for (const one of list) {
        total += one.bump();
        letters += one.tag.length;
      }
    }
  } catch (error) {
    return (error as Error).name;
  }
  return (typeof total === "number" ? String(total) : typeof total + String(total).length) + "/" + letters;
}

const world: Tracked[] = [new Fast(resolve => resolve(1)), new Slow(resolve => resolve(2)), new Tracked(resolve => resolve(3))];
const seen: unknown[] = [measure(world), made];
`;
const TRACKED_END = `await new Promise(resolve => setTimeout(resolve, 1));
seen.push(measure(world), made);
console.log(seen.join(" "));
`;
function tracked(slug: string, head: string, attack: string, { classes = TRACKED, ...more }: Record<string, any> = {}) {
  program("promise-subclasses-" + slug, head, attack, { classes, measure: TRACKED_MEASURE, end: TRACKED_END, ...more });
}

tracked(
  "what-then-makes-has-the-fields-and-methods-of-the-class",
  "`then` on an instance of a subclass of Promise constructs that subclass, so what it answers with has the fields and methods of the class and joins the others in the loop.",
  "const next = world[0].then(value => value + 1) as Fast;\nseen.push(next instanceof Fast, next.speed, next.bump(), await next);\nworld.push(next);",
);
const COUNTED: [string, string, string][] = [
  ["then", "`then`", "world[0].then(value => value);"],
  ["catch", "`catch`", "world[0].catch(() => 0);"],
  ["finally", "`finally`", "world[0].finally(() => {});"],
  ["await", "`await`", "seen.push(await world[0]);"],
  ["an-async-return", "the return of an async function", "seen.push(await (async () => world[0])());"],
  ["promise-resolve", "Promise.resolve", "seen.push(Promise.resolve(world[0]) === world[0]);"],
  ["its-own-resolve", "`resolve` of the subclass itself, with an instance and with a number", "seen.push(Fast.resolve(world[0]) === world[0], Fast.resolve(5) instanceof Fast, Fast.resolve(world[1]) instanceof Fast);"],
  ["promise-all", "Promise.all", "seen.push((await Promise.all(world)).join());"],
  ["its-own-all", "`all` of the subclass itself", "seen.push(Fast.all([1, world[1]]) instanceof Fast);"],
  ["promise-race", "Promise.race", "seen.push(await Promise.race(world));"],
  ["a-resolve-function", "the resolve function of an executor", "seen.push(await new Promise(resolve => resolve(world[0])));"],
  ["the-result-of-a-reaction", "what a reaction returns", "seen.push(await Promise.resolve(0).then(() => world[0]));"],
  ["with-resolvers", "`withResolvers` of the subclass itself", "seen.push((Fast as any).withResolvers().promise instanceof Fast);"],
  ["for-await", "a `for await` loop over an array", "for await (const value of world) seen.push(value);"],
];
for (const [slug, words, attack] of COUNTED) {
  tracked(
    "the-constructor-counts-its-calls-by-" + slug,
    "The constructor of a subclass of Promise counts its calls. An instance goes through " + words + ", and the count tells how often native code has constructed the class.", attack,
  );
}
const SPECIES: [string, string, string][] = [["promise", "Promise", "Promise"], ["another-class", "the other subclass", "Slow"], ["null", "null", "null"], ["undefined", "undefined", "undefined"], ["the-base-class", "the base class", "Tracked"]];
for (const [slug, words, value] of SPECIES) {
  tracked(
    "species-answers-" + slug,
    "The static Symbol.species getter of a subclass of Promise answers " + words + ", so that is what `then`, `catch` and `finally` construct; what they answer with is used under the type of the subclass.",
    'let asked = 0;\nfor (const next of [world[0].then(value => value), world[0].catch(() => 0), world[0].finally(() => {})] as Fast[]) {\n  seen.push(next.constructor.name, next.speed, typeof next.bump === "function" ? next.bump() : "none");\n}\nseen.push(asked);',
    { heavy: `static get [Symbol.species](): any {\n  asked++;\n  return ${value};\n}` },
  );
}
tracked(
  "two-levels-below-promise",
  "A class two levels below a subclass of Promise: `then` constructs the lowest class, with the fields of all levels.",
  "class Fastest extends Fast {\n  gear = 3;\n  bump(): number {\n    return (this.hits += this.speed * this.gear);\n  }\n}\nconst first = new Fastest(resolve => resolve(4));\nconst next = first.then(value => value * 2) as Fastest;\nseen.push(next instanceof Fastest, next.gear, next.bump(), await next);\nworld.push(first, next);",
);
tracked(
  "constructor-is-overwritten-on-one-plain-promise",
  "One plain promise gets an own `constructor` whose Symbol.species is a class of the program, so `then` on it, and an `await` of it, construct that class.",
  "const plain = Promise.resolve(1);\n(plain as any).constructor = { [Symbol.species]: Fast };\nconst next = plain.then(value => value + 1) as Fast;\nseen.push(next instanceof Fast, next.speed, made, await plain, made);\nworld.push(next);",
);
tracked(
  "then-is-overridden-and-writes-to-its-receiver",
  "A subclass of Promise overrides `then`. `await` calls the override, which stores a string into a number field of its receiver before it goes on to the built-in.",
  "seen.push(await world[0], await Promise.resolve(world[0]), typeof world[0].hits);",
  { heavy: 'then<A, B>(fulfilled?: ((value: number) => A | PromiseLike<A>) | null, rejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {\n  (this as any).hits = "1";\n  return super.then(fulfilled, rejected);\n}' },
);
tracked(
  "the-executor-of-native-code-is-kept-in-a-field",
  "The constructor of a subclass of Promise keeps its executor in a field. Every `new` in the program passes a closure with one parameter; `then` constructs the class with a function of native code.",
  "const next = world[0].then(value => value) as Fast;\nseen.push(world.map(one => one.kept.length).join(), next.kept.length, next.kept.name.length);",
  { classes: TRACKED.replaceAll('  tag = "t";\n', '  tag = "t";\n  kept: Function;\n').replaceAll("    made++;\n", "    made++;\n    this.kept = executor;\n") },
);
tracked(
  "a-reaction-writes-to-the-promise-it-hangs-on",
  "A reaction of an instance of a subclass of Promise stores a string into a number field of that instance.",
  'await world[0].then(() => void ((world[0] as any).hits = "1"));',
);

function strange(slug: string, head: string, attack: string, { ...more }: Record<string, any> = {}) {
  program("promise-subclasses-" + slug, head, attack, { ...more });
}
const EXECUTOR = "const executor = (resolve: (value: number) => void): void => resolve(7);";
const WORLD = 'const world: Body[] = [new Heavy(1, "a"), new Light(2, "bb"), new Body(3, "ccc"), new Heavy(4, "d")];';
strange(
  "the-class-object-is-put-under-promise-before-instances-are-made",
  "Object.setPrototypeOf puts a class object under Promise before the first instance is made, so `super()` reaches Promise though the text says that the class extends another: the instances are promises without the fields of the base class.",
  "const strange = world[0];\nseen.push((await strange) === strange, await Promise.prototype.then.call(strange, value => value), strange.mass, (strange as Heavy).extra);",
  { pre: EXECUTOR, classes: CLASSES + "\nObject.setPrototypeOf(Heavy, Promise);\n", measure: MEASURE.replaceAll(WORLD, 'const world: Body[] = [new Heavy(executor as any, "a"), new Light(2, "bb"), new Body(3, "ccc")];') },
);
strange(
  "the-base-is-a-variable-that-holds-promise-when-the-class-is-evaluated",
  "A class extends what a variable holds. The variable is given the base class first and Promise afterwards, before the class is evaluated, so the instances are promises.",
  "const strange = world[0];\nseen.push(strange instanceof Promise, strange instanceof Body, await strange, strange.mass, (strange as Heavy).extra);",
  { pre: EXECUTOR, classes: CLASSES.replaceAll("class Heavy extends Body {", "let Base: unknown = Body;\nBase = Promise;\n\nclass Heavy extends (Base as typeof Body) {"), measure: MEASURE.replaceAll(WORLD, 'const world: Body[] = [new Heavy(executor as any, "a"), new Light(2, "bb"), new Body(3, "ccc")];') },
);
strange(
  "reflect-construct-makes-a-promise-with-the-prototype-of-a-class",
  "Reflect.construct(Promise, [executor], Heavy) makes a promise that lies under the prototype object of a class of the program and has none of its fields; it joins the instances in the loop.",
  "const strange = Reflect.construct(Promise, [executor], Heavy) as unknown as Heavy;\nseen.push(strange instanceof Heavy, strange instanceof Promise, (await strange) === strange, await Promise.prototype.then.call(strange, value => value), strange.extra);\nworld.push(strange);", { pre: EXECUTOR },
);
strange(
  "reflect-construct-makes-an-instance-with-the-prototype-of-a-promise-subclass",
  "Reflect.construct(Body, arguments, P) runs the constructor of a class of the program on an object that lies under a subclass of Promise: it has the fields, finds the built-in `then`, and is no promise, so an `await` of it throws a TypeError.",
  'class P extends Promise<number> {}\nconst strange = Reflect.construct(Body, [5, "e"], P) as Body;\nseen.push(strange instanceof Body, strange instanceof P, strange.mass, typeof strange.weight);\ntry {\n  seen.push(await strange);\n} catch (error) {\n  seen.push((error as Error).name);\n}\nworld.push(strange);',
);
strange(
  "the-built-in-then-is-stored-on-the-prototype-of-a-class",
  "The built-in Promise.prototype.then is stored on the prototype object of a class of the program, whose instances are no promises, so an `await` of one throws a TypeError.",
  "(Heavy.prototype as any).then = Promise.prototype.then;\nfor (const body of world) {\n  try {\n    seen.push((await body) === body);\n  } catch (error) {\n    seen.push((error as Error).name);\n  }\n}",
);
strange(
  "the-base-class-is-put-under-promise-prototype",
  "Object.setPrototypeOf puts the prototype object of the base class under Promise.prototype, so every instance finds the built-in `then` and is no promise: an `await` of one throws a TypeError.",
  "seen.push((await world[1]) === world[1]);\nObject.setPrototypeOf(Body.prototype, Promise.prototype);\ntry {\n  seen.push(await world[1]);\n} catch (error) {\n  seen.push((error as Error).name, world[1] instanceof Promise);\n}",
);
strange(
  "the-built-in-then-is-called-on-an-instance",
  "The built-in `then`, `catch` and `finally` are called with an instance of a class of the program as their receiver; `catch` and `finally` call the `then` that they find on it.",
  "for (const run of [() => Promise.prototype.then.call(world[0], () => 0), () => Promise.prototype.catch.call(world[0], () => 0), () => Promise.prototype.finally.call(world[1], () => 0)]) {\n  try {\n    seen.push(typeof run());\n  } catch (error) {\n    seen.push((error as Error).name);\n  }\n}\nseen.push(calls);", { pre: CALLS, light: 'then(first: unknown, second: unknown): string {\n  calls++;\n  (this as any).lift = "x";\n  return typeof first + typeof second;\n}' },
);

strange(
  "a-mixin-function-is-given-promise",
  "A function answers with a class that extends whatever it is given. It is given the base class at one place and Promise at another, so one of the two classes it made is a subclass of Promise.",
  'const Plain = extend(Body);\nconst Waiting = extend(Promise as any) as any;\nconst plain = new Plain(5, "e");\nconst waiting = new Waiting(executor);\nworld.push(plain);\nseen.push((await plain) === plain, plain.marked, await waiting, waiting.marked, waiting instanceof Promise, waiting.then(() => 0).marked);',
  { pre: EXECUTOR + "\nfunction extend<Base extends new (...list: any[]) => object>(base: Base) {\n  return class extends base {\n    marked = 1;\n  };\n}" },
);
strange(
  "the-base-is-chosen-at-run-time",
  "A class extends the base class or Promise, by a value that is read at run time.",
  "const strange = world[0];\nseen.push(strange instanceof Promise, strange instanceof Body, await strange, strange.mass, (strange as Heavy).extra);",
  { pre: EXECUTOR, classes: CLASSES.replaceAll("class Heavy extends Body {", 'class Heavy extends ((JSON.parse("1") ? Promise : Body) as typeof Body) {'), measure: MEASURE.replaceAll(WORLD, 'const world: Body[] = [new Heavy(executor as any, "a"), new Light(2, "bb"), new Body(3, "ccc")];') },
);
strange(
  "a-real-promise-under-a-class-whose-prototype-lies-under-promise-prototype",
  "The prototype object of a class is put under Promise.prototype, and Reflect.construct makes a real promise under it: an `await` of that one gives what it was resolved with, and an `await` of an ordinary instance of the class throws a TypeError.",
  "Object.setPrototypeOf(Heavy.prototype, Promise.prototype);\nconst real = Reflect.construct(Promise, [executor], Heavy) as unknown as Heavy;\nseen.push(await real, real instanceof Heavy, real.extra);\ntry {\n  seen.push(await world[0]);\n} catch (error) {\n  seen.push((error as Error).name);\n}", { pre: EXECUTOR },
);
// OTHER HANDS: native functions that answer with what they were given, accessors of the language found by name, and other hands an instance goes through.
const BACK: [string, string, string][] = [
  ["value-of", "the `valueOf` that it inherits from Object.prototype", "world[0].valueOf()"],
  ["the-object-function", "the function Object", "Object(world[0])"],
  ["object-seal", "Object.seal, which answers with its argument", "Object.seal(world[0])"],
  ["object-assign", "Object.assign, which answers with its target", "Object.assign(world[0], {})"],
  ["object-define-property", "Object.defineProperty, which answers with its first argument", 'Object.defineProperty(world[0], "note", { value: 1, enumerable: true })'],
  ["object-set-prototype-of", "Object.setPrototypeOf, which answers with its first argument", "Object.setPrototypeOf(world[0], Heavy.prototype)"],
  ["array-at", "an array and its method `at`", "[world[0]].at(0)"],
  ["array-find", "an array and its method `find`", "world.find(body => body.mass === 1)"],
  ["a-set", "a Set and its iterator", "new Set([world[0]]).values().next().value"],
  ["a-map", "a Map", 'new Map([["k", world[0]]]).get("k")'],
  ["a-weak-ref", "a WeakRef", "new WeakRef(world[0]).deref()"],
  ["object-values", "an object and Object.values", "Object.values({ k: world[0] })[0]"],
  ["reflect-get", "an object and Reflect.get", 'Reflect.get({ k: world[0] }, "k")'],
  ["reflect-apply", "Reflect.apply of a function that answers with its argument", "Reflect.apply((body: Body) => body, null, [world[0]])"],
  ["a-bound-function", "a bound function that answers with its bound argument", "((body: Body) => body).bind(null, world[0])()"],
  ["the-detail-of-an-event", "the `detail` of a CustomEvent", 'new CustomEvent("e", { detail: world[0] }).detail'],
  ["the-cause-of-an-error", "the `cause` of an Error", 'new Error("e", { cause: world[0] }).cause'],
  ["the-reason-of-a-signal", "the `reason` of an aborted signal", "AbortSignal.abort(world[0]).reason"],
  ["a-spread-copy-of-a-holder", "a spread copy of an object that holds it", "({ ...{ k: world[0] } }).k"],
  ["a-generator", "a generator that yields it", "(function* () {\n  yield world[0];\n})().next().value"],
];
for (const [slug, words, path] of BACK) {
  program(
    "comes-back-through-" + slug, "An instance goes through " + words + ", and a string is stored into a number field of what comes back.",
    `const out: any = ${path};\nout.mass = "9";\nseen.push(out === world[0]);`,
  );
}

const NAMED: [string, string, string, string][] = [
  ["the-proto-setter-on-a-value-of-type-any", "A function stores to `__proto__` of a parameter of type any, which puts an instance under the other subclass.", "reparent(world[0], Light.prototype);", "function reparent(object: any, above: object): void {\n  object.__proto__ = above;\n}"],
  ["the-proto-getter-and-a-store-into-what-it-answers", "A function reads `__proto__` of a parameter of type any and stores a method into what it gets, the prototype object of a class.", "patch(world[0]);", 'function patch(object: any): void {\n  object.__proto__.weight = () => "w";\n}'],
  ["define-getter", "`__defineGetter__`, which every object inherits, turns a number field of an instance into an accessor that answers a string.", '(world[0] as any).__defineGetter__("mass", () => "3");', ""],
  ["define-setter", "`__defineSetter__`, which every object inherits, turns a number field of an instance into an accessor without a getter, so a read gives undefined and a store runs the setter.", '(world[0] as any).__defineSetter__("mass", (value: unknown) => seen.push(typeof value));\nworld[0].mass = 8;', ""],
  ["the-constructor-read-by-name", "A function reads `constructor` of a parameter of type any and constructs it with arguments of other types; the new instance joins the others in the loop.", "world.push(again(world[0]));", 'function again(object: any): Body {\n  return new object.constructor("5", 7);\n}'],
  ["has-own-property-with-a-key-that-writes", "`hasOwnProperty` converts its argument to a key, which runs a `toString` that stores a string into a number field of the receiver.", 'seen.push(world[0].hasOwnProperty({ toString: () => (((world[0] as any).mass = "9"), "mass") } as any));', ""],
  ["to-string-reads-the-tag", "Object.prototype.toString reads Symbol.toStringTag of its receiver, an accessor of the class that stores a string into a number field.", "seen.push(String(world[0]));", ""],
  ["to-locale-string-calls-to-string", "`toLocaleString`, which every object inherits, calls the `toString` of its receiver, a method of the class that stores a string into a number field.", "seen.push(world[1].toLocaleString());", ""],
];
for (const [slug, head, attack, pre] of NAMED) {
  program(
    "found-by-name-" + slug, head, attack, { pre, heavy: slug.includes("the-tag") ? 'get [Symbol.toStringTag](): string {\n  (this as any).mass = "9";\n  return "Heavy";\n}' : "", light: slug.includes("to-locale") ? 'toString(): string {\n  (this as any).mass = "9";\n  return "light";\n}' : "" },
  );
}

const HANDS: [string, string, string, string][] = [
  ["an-emitter", "An emitter passes an instance on to a listener", 'new EventEmitter().on("e", spoil).emit("e", world[0]);', 'import { EventEmitter } from "node:events";'],
  ["events-once", "The promise of events.once holds an instance in an array, and whoever awaits it", 'const emitter = new EventEmitter();\nconst waiting = once(emitter, "e");\nemitter.emit("e", world[0]);\nspoil((await waiting)[0]);', 'import { EventEmitter, once } from "node:events";'],
  ["an-event-target", "An EventTarget passes an event with an instance as its `detail` on to a listener", 'const target = new EventTarget();\ntarget.addEventListener("e", event => spoil((event as CustomEvent).detail));\ntarget.dispatchEvent(new CustomEvent("e", { detail: world[0] }));', ""],
  ["async-local-storage", "An AsyncLocalStorage keeps an instance as its store across a timer, and whoever asks for the store there", "const storage = new AsyncLocalStorage<Body>();\nawait new Promise<void>(resolve => storage.run(world[0], () => setTimeout(() => resolve(spoil(storage.getStore())), 1)));", 'import { AsyncLocalStorage } from "node:async_hooks";'],
  ["the-promise-of-a-timer", "setTimeout of node:timers/promises resolves with the instance that it was given, and whoever awaits it", "spoil(await sleep(1, world[0]));", 'import { setTimeout as sleep } from "node:timers/promises";'],
  ["the-promise-of-an-immediate", "setImmediate of node:timers/promises resolves with the instance that it was given, and whoever awaits it", "spoil(await soon(world[0]));", 'import { setImmediate as soon } from "node:timers/promises";'],
  ["the-iterator-of-an-interval", "setInterval of node:timers/promises yields the instance that it was given, and the loop over it", "for await (const body of every(1, world[0])) {\n  spoil(body);\n  break;\n}", 'import { setInterval as every } from "node:timers/promises";'],
  ["a-promisified-timer", "util.promisify(setTimeout) resolves with the instance that it was given, and whoever awaits it", "spoil(await promisify(setTimeout)(1, world[0]));", 'import { promisify } from "node:util";'],
  ["a-promisified-function", "A function made by util.promisify resolves with the instance that the callback was given, and whoever awaits it", "spoil(await promisify((done: (error: null, body: Body) => void) => done(null, world[0]))());", 'import { promisify } from "node:util";'],
  ["a-web-stream", "A ReadableStream hands on an instance that was put into it, and whoever reads it", "const reader = new ReadableStream({ start: controller => controller.enqueue(world[0]) }).getReader();\nspoil((await reader.read()).value);", ""],
  ["a-node-stream", "A Readable in object mode hands on an instance, and the loop over it", "for await (const body of Readable.from([world[0]])) spoil(body);", 'import { Readable } from "node:stream";'],
  ["a-tick-that-throws", 'A callback of process.nextTick throws an instance, and the "uncaughtException" listener of the process', 'process.on("uncaughtException", spoil);\nprocess.nextTick(() => {\n  throw world[0];\n});\nawait new Promise(resolve => setTimeout(resolve, 5));', ""],
  ["a-bound-callback-of-a-tick", "process.nextTick calls a bound function whose bound argument is an instance, and that function", "process.nextTick(spoil.bind(null, world[0]));\nawait new Promise(resolve => setTimeout(resolve, 5));", ""],
  ["the-delay-of-a-timer", "setTimeout converts its delay, an instance, to a number, which calls the `valueOf` of the class, and that method", "await new Promise(resolve => setTimeout(resolve, world[0] as any));", ""],
];
for (const [slug, words, attack, imports] of HANDS) {
  program(
    "handed-on-by-" + slug, words + " stores a string into a number field of it.", attack, { imports, pre: slug.includes("the-delay") ? "" : 'function spoil(body: any): void {\n  body.mass = "9";\n}', heavy: slug.includes("the-delay") ? 'valueOf(): number {\n  (this as any).mass = "9";\n  return 1;\n}' : "" },
  );
}

const UNUSUAL: [string, string, string][] = [
  ["an-array-pattern", "an array pattern whose target is the property", "[(world[0] as any).then] = [then];"],
  ["an-object-pattern", "an object pattern whose target is the property", "({ a: (world[0] as any).then } = { a: then });"],
  ["the-head-of-a-for-of-loop", "the head of a `for of` loop whose target is the property", "for ((world[0] as any).then of [then]);"],
  ["reflect-set-with-a-receiver", "Reflect.set on another object with the instance as the receiver", 'Reflect.set({}, "then", then, world[0]);'],
  ["a-logical-assignment", "a logical assignment", "(world[0] as any).then ??= then;"],
  ["a-store-to-super", "a store to a property of `super` in a method, which lands on the receiver", "(world[0] as Heavy).arm();"],
  ["a-setter-of-the-class", "a setter of the class that stores under the name it is given", '(world[0] as Heavy).install = ["then", then];'],
  ["object-assign-from-entries", "Object.assign from an object that Object.fromEntries has made", 'Object.assign(world[0], Object.fromEntries([["then", then]]));'],
  ["define-property-under-a-computed-key", "Object.defineProperty under a key that is put together at run time", 'Object.defineProperty(world[0], ["th", "en"].join(""), { value: then });'],
  ["a-proxy-in-front-of-the-instance", "a store through a proxy with an empty handler", "(new Proxy(world[0], {}) as any).then = then;"],
  ["a-proxy-in-front-of-the-prototype-object", "a store through a proxy with an empty handler in front of the prototype object of the class", "(new Proxy(Heavy.prototype, {}) as any).then = then;"],
];
for (const [slug, words, install] of UNUSUAL) {
  program(
    "late-then-added-by-" + slug,
    "The first `await` of an instance gives the instance. Then `then` is added by " + words + ", and the second `await` calls it.",
    `seen.push((await world[0]) === world[0], measure(world));\n${install}\nseen.push(typeof (await world[0]), calls);`, { pre: THEN + (slug.includes("super") ? '\nconst key = "then" as "name";' : ""), heavy: slug.includes("super") ? "arm(): void {\n  super[key] = then as never;\n}" : slug.includes("setter") ? "set install([key, value]: [string, unknown]) {\n  (this as any)[key] = value;\n}" : "", body: "" },
  );
}
program(
  "thenables-then-is-a-method-under-a-computed-name",
  "The class body spells the name of a method as an expression, and the name that comes out at run time is `then`.",
  "seen.push((await world[1]) === world[1], typeof (await world[0]), calls);", { pre: CALLS + '\nconst name = ["th", "en"].join("");', heavy: METHOD.replaceAll("then(resolve", "[name](resolve") },
);
program(
  "thenables-then-is-a-getter-under-a-computed-name",
  "The class body spells the name of an accessor as an expression, and the name that comes out at run time is `then`.",
  "seen.push((await world[1]) === world[1], typeof (await world[0]), calls);", { pre: CALLS + '\nconst name = ["th", "en"].join("");', heavy: 'get [name](): (resolve: (value: unknown) => void) => void {\n  calls++;\n  return resolve => {\n    (this as any).mass = "9";\n    resolve(calls);\n  };\n}' },
);
program(
  "thenables-then-is-added-in-a-static-block",
  "A static block of the class stores a function on the prototype object of the class under a name that is put together at run time.",
  "seen.push((await world[1]) === world[1], typeof (await world[0]), calls);", { pre: THEN, heavy: 'static {\n  (this.prototype as any)[["th", "en"].join("")] = then;\n}' },
);
program(
  "thenables-then-is-inherited-from-a-constructor-function",
  "The base class extends a plain function whose prototype object has a `then`, so the instances of all three classes are thenables.",
  "for (const body of world) seen.push(typeof (await body));\nseen.push(calls);", { pre: THEN + "\nfunction Old(this: unknown): void {}\nOld.prototype.then = then;", classes: CLASSES.replaceAll("class Body {", "class Body extends (Old as unknown as new () => object) {").replaceAll("  constructor(mass: number, label: string) {\n", "  constructor(mass: number, label: string) {\n    super();\n") },
);
program(
  "thenables-the-object-above-the-base-class-gets-its-then-later",
  "An empty object is put above the prototype object of the base class, and gets a `then` under a computed key only after the first `await`.",
  'const above: any = {};\nObject.setPrototypeOf(Body.prototype, above);\nseen.push((await world[2]) === world[2], measure(world));\nabove[["th", "en"].join("")] = then;\nseen.push(typeof (await world[2]), calls);', { pre: THEN },
);
program(
  "thenables-the-class-object-itself-is-awaited",
  "A class has a static method `then`, so the class object is a thenable: an `await` of it calls the method, which replaces a method on the prototype object of the class.",
  "seen.push(typeof (await (Heavy as any)), calls);", { pre: CALLS, heavy: 'static then(resolve: (value: unknown) => void): void {\n  calls++;\n  (this.prototype as any).weight = () => "w";\n  resolve(calls);\n}' },
);
program(
  "thenables-the-getter-of-then-throws-its-receiver",
  "`then` is an accessor of the class whose getter throws its receiver, so the `await` throws an instance, and the catch clause stores a string into a number field of what it caught.",
  'try {\n  await world[0];\n} catch (caught) {\n  (caught as any).mass = "9";\n  seen.push(caught === world[0], calls);\n}', { pre: CALLS, heavy: "get then(): unknown {\n  calls++;\n  throw this;\n}" },
);
// WRONG HERITAGE: the text says that a class extends a class of the program, and its instances are built-in objects all the same.
// name, arguments, what fills it
const KINDS: [string, string, string][] = [
  ["Promise", "executor", ""],
  ["Array", "", "strange.push(1, 2);"],
  ["Map", "", 'strange.set(1, "one");'],
  ["Set", "", "strange.add(1);"],
  ["Error", '"message"', ""],
  ["RegExp", '"a+", "g"', ""],
  ["Date", "0", ""],
  ["Uint8Array", "2", ""],
];
const H_BODY = `class Body {
  mass = 1;
  constructor(...ignored: unknown[]) {}
  weight(): number {
    return this.mass * 2;
  }
}
`;
const H_HEAVY = `class Heavy extends Body {
  extra = 5;
  constructor(...list: unknown[]) {
    super(...list);
  }
  weight(): number {
    return (this.extra === undefined ? 7 : this.extra * 3) + (this.mass === undefined ? 100 : this.mass);
  }
}
`;
const H_LIGHT = `class Light extends Body {
  lift = 1;
  weight(): number {
    return this.mass - this.lift;
  }
}
`;
const H_REST = `
function measure(bodies: Body[]): string {
  let total = 0;
  try {
    for (let round = 0; round < 200; round++) {
      for (const body of bodies) total += (typeof body.weight === "function" ? body.weight() : -1) + (body.mass === undefined ? 1000 : body.mass);
    }
  } catch (error) {
    return (error as Error).name;
  }
  return String(total);
}

function attempt(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return (error as Error).name;
  }
}

async function probe(x: any): Promise<string> {
  const lengthOfTypedArray = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length")!.get!;
  const resolved = Promise.resolve(x);
  resolved.catch(() => {});
  return [
    typeof x,
    Array.isArray(x),
    attempt(() => JSON.stringify(x)),
    attempt(() => [0].concat(x).length),
    attempt(() => Array.from(x).length),
    attempt(() => Object.prototype.toString.call(structuredClone(x))),
    Object.prototype.toString.call(x),
    [types.isPromise(x), types.isMap(x), types.isSet(x), types.isRegExp(x), types.isDate(x), types.isNativeError(x), types.isUint8Array(x)].map(Number).join(""),
    resolved === x,
    await (async () => (await x) === x)().catch(error => (error as Error).name),
    x instanceof @X,
    x instanceof Heavy,
    attempt(() => Promise.prototype.then.call(x, () => 0) instanceof Promise),
    attempt(() => Map.prototype.get.call(x, 1)),
    attempt(() => Set.prototype.has.call(x, 1)),
    attempt(() => RegExp.prototype.exec.call(x, "caab")?.[0]),
    attempt(() => Date.prototype.getTime.call(x)),
    attempt(() => lengthOfTypedArray.call(x)),
    typeof x.stack,
    attempt(() => inspect(x).split("\\n")[0]),
    types.isNativeError(x) ? "error" : Bun.inspect(x).split("\\n")[0],
    Object.keys(x).join("+"),
    [attempt(() => x.length), attempt(() => x.size), attempt(() => x.source), attempt(() => x.message), attempt(() => x.byteLength), x[0], 0 in x].join("/"),
    [typeof x.then, typeof x.getTime, typeof x.has, typeof x.push, typeof x.exec, typeof x.fill].map(kind => kind.length).join(""),
    attempt(() => {
      let steps = 0;
      for (const one of x) steps += one === undefined ? 1 : 2;
      return steps;
    }),
    attempt(() => [...x].length),
    attempt(() => ((x[5] = 300), x[5] + "/" + x.length)),
    attempt(() => ((x.length = 1), Object.keys(x).length)),
    attempt(() => (Error.captureStackTrace(x), typeof x.stack)),
  ].join();
}

@MAKE
const world: Body[] = [@HONEST, new Light(), @PLAIN, strange];
const seen: unknown[] = [measure(world)];
seen.push(await probe(world[0]), await probe(strange), measure(world));
console.log(seen.join(" "));
`;
const EXECUTOR_H = "const executor = (resolve: (value: number) => void): void => resolve(7);\n\n";
function heritage(slug: string, kind: string, head: string, classes: string, make: string, fill: string, honest = "new Heavy()", plain = "new Body()") {
  let text = "// " + head + '\nimport { inspect, types } from "node:util";\n\n' + (kind === "Promise" ? EXECUTOR_H : "") + classes;
  text += H_REST.replaceAll("@X", kind).replaceAll("@MAKE", make + (fill ? "\n" + fill : "")).replaceAll("@HONEST", honest).replaceAll("@PLAIN", plain);
  const name = `wrong-heritage-${{ RegExp: "regexp", Uint8Array: "uint8array" }[kind] ?? kind.toLowerCase()}-${slug}.ts`;
  if (name in filesWritten) throw new Error(name);
  filesWritten[name] = text;
}

for (const [kind, arguments_, fill] of KINDS) {
  const a = "AEU".includes(kind[0]) ? "an" : "a";
  heritage(
    "the-class-object-is-put-under-it-before-instances-are-made", kind,
    `The text says that Heavy extends Body, which extends nothing. Before the first instance is made, Object.setPrototypeOf puts Heavy under ${kind} and its prototype object under ${kind}.prototype, so \`super()\` makes a real ${kind}.`,
    H_BODY + "\n" + H_HEAVY + "\n" + H_LIGHT + `\nObject.setPrototypeOf(Heavy, ${kind});\nObject.setPrototypeOf(Heavy.prototype, ${kind}.prototype);\n`,
    `const strange: any = new Heavy(${arguments_});`, fill, "new Light()",
  );
  for (const word of ["let", ...(["Promise", "Array", "Map"].includes(kind) ? ["var"] : [])]) {
    heritage(
      `the-base-is-a-${word}-variable-that-is-reassigned`, kind,
      `Body is a \`${word}\` variable that holds a class expression. Light is evaluated while it does; then the variable is given ${kind}, and \`class Heavy extends Body\` is evaluated after that.`,
      H_BODY.replaceAll("class Body {", `${word} Body = class {`).replace(/\n+$/, "") + ";\ntype Body = InstanceType<typeof Body>;\nconst Original = Body;\n\n" + H_LIGHT + `\nBody = ${kind} as any;\n\n` + H_HEAVY,
      `const strange: any = new Heavy(${arguments_});`, fill, "new Light()", "new Original()",
    );
  }
  heritage(
    "the-base-is-chosen-by-a-flag", kind,
    `Heavy extends Body or ${kind}, by a flag that is read at run time.`,
    H_BODY + '\nconst flag = JSON.parse("0");\n\n' + H_HEAVY.replaceAll("class Heavy extends Body {", `class Heavy extends ((flag ? Body : ${kind}) as typeof Body) {`) + "\n" + H_LIGHT,
    `const strange: any = new Heavy(${arguments_});`, fill, "new Light()",
  );
  heritage(
    "a-mixin-is-applied-to-the-base-class-and-to-it", kind,
    `One class expression in a function extends whatever the function is given: Body at one place, ${kind} at another. The instances of the first are ordinary objects, those of the second are real instances of ${kind}.`,
    H_BODY + "\nconst mix = (base: typeof Body) =>\n  " + H_HEAVY.replaceAll("class Heavy extends Body {", "class extends base {").replace(/\n+$/, "").replaceAll("\n", "\n  ") + `;\nconst Heavy = mix(Body);\nconst Strange = mix(${kind} as any);\n\n` + H_LIGHT,
    `const strange: any = new Strange(${arguments_});`, fill,
  );
  heritage(
    "reflect-construct-with-the-class-as-new-target", kind,
    `Reflect.construct(${kind}, arguments, Heavy) makes a real ${kind} under the prototype object of Heavy, without the fields of Heavy or Body; an honest Heavy stands beside it.`,
    H_BODY + "\n" + H_HEAVY + "\n" + H_LIGHT, `const strange: any = Reflect.construct(${kind}, [${arguments_}], Heavy);`,
    { Array: "Array.prototype.push.call(strange, 1, 2);", Map: 'Map.prototype.set.call(strange, 1, "one");', Set: "Set.prototype.add.call(strange, 1);" }[kind] ?? "",
  );
  heritage(
    "the-base-constructor-returns-one", kind,
    `The constructor of Body returns what a function that it is given makes, ${a} ${kind} here, so \`this\` in the constructor of Heavy is that object: it gets the fields of Heavy and none of its methods. An honest Heavy stands beside it.`,
    H_BODY.replaceAll("  constructor(...ignored: unknown[]) {}\n", "  constructor(make?: () => object) {\n    if (make) return make() as Body;\n  }\n") + "\n" + H_HEAVY.replaceAll("  constructor(...list: unknown[]) {\n    super(...list);\n  }\n", "  constructor(make?: () => object) {\n    super(make);\n  }\n") + "\n" + H_LIGHT,
    `const strange: any = new Heavy(() => new ${kind}(${arguments_}));`, fill,
  );
}
heritage(
  "the-base-constructor-returns-one", "Function",
  "The constructor of Body returns what a function that it is given makes, a closure here, so `this` in the constructor of Heavy is a function: it gets the fields of Heavy and none of its methods. An honest Heavy stands beside it.",
  H_BODY.replaceAll("  constructor(...ignored: unknown[]) {}\n", "  constructor(make?: () => object) {\n    if (make) return make() as Body;\n  }\n") + "\n" + H_HEAVY.replaceAll("  constructor(...list: unknown[]) {\n    super(...list);\n  }\n", "  constructor(make?: () => object) {\n    super(make);\n  }\n") + "\n" + H_LIGHT,
  "const strange: any = new Heavy(() => () => 1);", "",
);

const FILL_BY_CALL = { Array: "Array.prototype.push.call(strange, 1, 2);", Map: 'Map.prototype.set.call(strange, 1, "one");', Set: "Set.prototype.add.call(strange, 1);" };
for (const [kind, arguments_, fill] of KINDS) {
  const a = "AEU".includes(kind[0]) ? "an" : "a";
  heritage(
    "the-class-declaration-of-the-base-is-assigned-to", kind,
    `Body is a class declaration that extends nothing, and Light is evaluated under it. Then the name Body is assigned ${kind}, which a class declaration allows, and \`class Heavy extends Body\` is evaluated after that.`,
    H_BODY + "const Original = Body;\n\n" + H_LIGHT + `\n(Body as any) = ${kind};\n\n` + H_HEAVY,
    `const strange: any = new Heavy(${arguments_});`, fill, "new Light()", "new Original()",
  );
  heritage(
    "the-constructor-of-the-class-returns-one", kind,
    `The constructor of Heavy returns ${a} ${kind} where it is given a function that makes one, so that is what \`new Heavy\` answers with, under the type Heavy: it has neither the fields nor the methods. An honest Heavy stands beside it.`,
    H_BODY + "\n" + H_HEAVY.replaceAll("  constructor(...list: unknown[]) {\n    super(...list);\n  }\n", "  constructor(make?: () => object) {\n    super();\n    if (make) return make() as Heavy;\n  }\n") + "\n" + H_LIGHT,
    `const strange: any = new Heavy(() => new ${kind}(${arguments_}));`, fill,
  );
}
for (const [kind, arguments_, fill] of KINDS) {
  if (!["Promise", "Array", "Map"].includes(kind)) {
    continue;
  }
  heritage(
    "the-class-object-is-put-under-it-after-the-first-instance", kind,
    `One function makes every Heavy. The first is an honest one; then Object.setPrototypeOf puts Heavy under ${kind} and its prototype object under ${kind}.prototype, and the same \`new\` expression makes a real ${kind}.`,
    H_BODY + "\n" + H_HEAVY + "\n" + H_LIGHT + `\nconst make = (...list: unknown[]): Heavy => new Heavy(...list);\nconst early = make();\nObject.setPrototypeOf(Heavy, ${kind});\nObject.setPrototypeOf(Heavy.prototype, ${kind}.prototype);\n`,
    `const strange: any = make(${arguments_});`, fill, "early",
  );
  heritage(
    "a-proxy-above-the-class-object-constructs-one", kind,
    `Object.setPrototypeOf puts Heavy under a proxy in front of Body, so \`super()\` reaches the \`construct\` trap, which makes a real ${kind} under the prototype object of Heavy.`,
    H_BODY + "\n" + H_HEAVY + "\n" + H_LIGHT + `\nObject.setPrototypeOf(Heavy, new Proxy(Body, { construct: (target, list, newTarget) => Reflect.construct(${kind}, list, newTarget) }));\n`,
    `const strange: any = new Heavy(${arguments_});`, FILL_BY_CALL[kind] ?? "", "new Light()",
  );
  heritage(
    "a-plain-function-constructs-one", kind,
    `Heavy extends Body, and Body extends a plain function, which answers with a real ${kind} that it makes for its \`new.target\`.`,
    `function Root(this: unknown, real?: unknown): object {\n  return real ? Reflect.construct(${kind}, [${arguments_}], new.target!) : (this as object);\n}\n\n` + H_BODY.replaceAll("class Body {", "class Body extends (Root as unknown as new (...list: unknown[]) => object) {").replaceAll("  constructor(...ignored: unknown[]) {}\n", "  constructor(...list: unknown[]) {\n    super(...list);\n  }\n") + "\n" + H_HEAVY + "\n" + H_LIGHT,
    "const strange: any = new Heavy(true);", FILL_BY_CALL[kind] ?? "",
  );
}

// Across modules: the base class is an exported `let` of another file, which a function of that file reassigns.
for (const [kind, arguments_, fill] of KINDS) {
  if (!["Promise", "Array", "Map", "Error"].includes(kind)) {
    continue;
  }
  const name = `wrong-heritage-${kind.toLowerCase()}-the-base-is-an-imported-variable-that-its-module-reassigns`;
  heritage(
    "TEMPORARY", kind,
    `Body is imported from another file, where it is a \`let\` variable that holds a class expression. Light is evaluated while it does; then a function of that file gives the variable ${kind}, and \`class Heavy extends Body\` is evaluated after that.`,
    'import { Body, replaceBody } from "./base";\ntype Body = InstanceType<typeof Body>;\nconst Original = Body;\n\n' + H_LIGHT + `\nreplaceBody(${kind});\n\n` + H_HEAVY,
    `const strange: any = new Heavy(${arguments_});`, fill, "new Light()", "new Original()",
  );
  filesWritten[name + "/main.ts"] = filesWritten[`wrong-heritage-${kind.toLowerCase()}-TEMPORARY.ts`];
  delete filesWritten[`wrong-heritage-${kind.toLowerCase()}-TEMPORARY.ts`];
  filesWritten[name + "/base.ts"] = H_BODY.replaceAll("class Body {", "export let Body = class {").replace(/\n+$/, "") + ";\n\nexport function replaceBody(other: unknown): void {\n  Body = other as typeof Body;\n}\n";
}
// MADE BY BUILT-INS: objects that a built-in has made (the array of map, the promise of Promise.resolve ..) and that take another road at run time than a fresh Array | Promise
// would: changed after they were made, instances of subclasses, made for another new.target, impostors, mixed with others. One attack a program.
ALIKE = 'const alike: any = { mass: "5", label: "zz", at: { x: "x" }, weight: () => "w", name: () => "n" };';
const KEEP = `const kinds: string[] = [];
function keep(body: Body, index: number): boolean {
  kinds.push((body instanceof Body ? "B" : typeof body) + (typeof index === "number" ? "" : ":" + typeof index));
  return true;
}`;
const ON_BODY = `const kinds: string[] = [];
function onBody(body: Body): Body {
  kinds.push(body instanceof Body ? "B" : typeof body);
  return body;
}`;
const CUSTOM = `function custom(this: unknown, test: (body: unknown, index: unknown) => boolean): unknown[] {
  test("text", "zero");
  return [alike];
}`;
const OTHER = `class Other {
  filter(test: (body: unknown, index: unknown) => boolean): unknown[] {
    return custom.call(this, test);
  }
}`;
const SWAPPING = `class Swapping extends Array<unknown> {
  constructor(length: number) {
    super(length);
    return new Proxy(this, {
      defineProperty: (target, key, descriptor) => Reflect.defineProperty(target, key, key === "length" ? descriptor : { ...descriptor, value: alike }),
    });
  }
}`;
const SWAPPED = `class Swapped extends Promise<unknown> {
  constructor(executor: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => void) {
    super((resolve, reject) => executor(() => resolve(alike), reject));
  }
}`;
const OTHER_P = `class OtherPromise {
  then(react: (body: unknown) => unknown): unknown {
    return react(alike);
  }
}`;
const SLEEP = "await new Promise(resolve => setTimeout(resolve, 1));";
function join(...parts: any[]) {
  return parts.filter(part => part).join("\n");
}
function built(slug: string, head: string, attack: string, { pre = "", ...more }: Record<string, any> = {}) {
  program("made-by-builtins-" + slug, head, attack, { pre, ...more });
}
function attemptLines(statement: string, indent = "") {
  return `try {\n  ${statement.replaceAll("\n", "\n  ")}\n} catch (error) {\n  seen.push((error as Error).name);\n}`;
}

// 2. the result is changed after it was made, before the second call
const MODES: [string, string, (change: any, first: any) => string, boolean][] = [
  ["directly", "directly", (change, first) => `const list: any = ${first};\n${change}`, false],
  ["in-a-helper", "in a helper function", (change, first) => `change(${first});`, true],
  ["through-an-alias-in-a-field", "through an alias in a field of another object", (change, first) => `const holder = { kept: ${first} };\nchange(holder.kept);`, true],
  ["by-a-function-that-only-a-tick-reaches", "by a function that only process.nextTick reaches", (change, first) => `process.nextTick(change, ${first});\n${SLEEP}`, true],
  ["by-a-function-that-only-a-reaction-reaches", "by a function that only a reaction of a promise reaches", (change, first) => `await Promise.resolve({ kept: ${first} }).then(holder => change(holder.kept));`, true],
];
// slug, words, the change to `list`, what it needs, in every mode?
const ARRAY_CHANGES: [string, string, string, string[], boolean][] = [
  ["an-own-constructor-with-a-species", "gets an own `constructor` whose Symbol.species is a class of the program, which `filter` then constructs", "list.constructor = { [Symbol.species]: Swapping };", [SWAPPING], true],
  ["an-own-filter", "gets an own `filter`, which calls the callback with two strings", "list.filter = custom;", [CUSTOM], true],
  ["another-prototype", "is put under the prototype object of a class of the program, whose `filter` calls the callback with two strings", "Object.setPrototypeOf(list, Other.prototype);", [CUSTOM, OTHER], true],
  ["a-getter-at-an-index", "gets an accessor at an index, which stores a string into a number field of an instance and answers a look-alike", 'Object.defineProperty(list, 1, { get: () => (((world[3] as any).mass = "9"), alike) });', [], true],
  ["an-own-constructor-that-is-a-subclass", "gets an own `constructor` that is a subclass of Array, which `filter` then constructs", "list.constructor = Swapping;", [SWAPPING], false],
  ["an-own-constructor-that-is-no-constructor", "gets an own `constructor` that is a number, so `filter` throws a TypeError", "list.constructor = 5;", [], false],
  ["an-own-constructor-without-a-species", "gets an own `constructor` that is an empty object, so `filter` makes a plain array", "list.constructor = {};", [], false],
  ["an-own-filter-by-define-property", "gets an own `filter` by Object.defineProperty", 'Object.defineProperty(list, "filter", { value: custom });', [CUSTOM], false],
  ["an-own-filter-by-object-assign", "gets an own `filter` by Object.assign", "Object.assign(list, { filter: custom });", [CUSTOM], false],
  ["an-own-filter-under-a-computed-key", "gets an own `filter` under a key that is put together at run time", 'list[["fil", "ter"].join("")] = custom;', [CUSTOM], false],
  ["no-prototype", "loses its prototype, so `filter` is not found", "Object.setPrototypeOf(list, null);", [], false],
  ["a-proxy-as-its-prototype", "is put under a proxy in front of Array.prototype, whose `get` trap answers another function for `filter`", 'Object.setPrototypeOf(list, new Proxy(Array.prototype, { get: (target, key, receiver) => (key === "filter" ? custom : Reflect.get(target, key, receiver)) }));', [CUSTOM], false],
  ["another-prototype-by-the-proto-setter", "is put under the prototype object of a class of the program by a store to `__proto__`", "list.__proto__ = Other.prototype;", [CUSTOM, OTHER], false],
  ["a-look-alike-at-an-index-by-object-assign", "gets a look-alike at an index by Object.assign", "Object.assign(list, { 1: alike });", [], false],
  ["a-look-alike-at-an-index-by-a-store", "gets a look-alike at an index by a plain store", "list[1] = alike;", [], false],
  ["a-look-alike-by-push", "gets a look-alike at its end by `push`", "list.push(alike);", [], false],
  ["a-look-alike-by-fill", "is filled with a look-alike", "list.fill(alike, 1, 2);", [], false],
  ["a-hole", "gets a hole by `delete`, which `filter` skips", "delete list[1];", [], false],
  ["a-shorter-length-by-define-property", "gets a shorter `length` by Object.defineProperty", 'Object.defineProperty(list, "length", { value: 1 });', [], false],
  ["a-longer-length", "gets a longer `length`, and so holes at its end", "list.length = 6;", [], false],
];
for (const [slug, words, change, needs, every] of ARRAY_CHANGES) {
  for (const [mode, modeWords, apply, helper] of MODES) {
    if (!every && mode !== "directly") {
      continue;
    }
    built(
      `the-array-of-map-gets-${slug}-${mode}`,
      `The array that \`map\` has made ${words}; that is done ${modeWords}. Then \`filter\` is called on it, and what comes out is used under the type of the instances.`,
      join("const first = world.map(body => body);", apply(change, "first"), attemptLines("seen.push(measure(first.filter(keep)));"), "seen.push(kinds.join());"),
      { pre: join(ALIKE, KEEP, ...needs, helper ? `function change(list: any): void {\n  ${change}\n}` : "") },
    );
  }
}
const FIRSTS: [string, string, string][] = [
  ["filter", "`filter`", "world.filter(() => true)"], ["slice", "`slice`", "world.slice()"], ["concat", "`concat`", "world.concat([])"], ["flat", "`flat`", "[world].flat()"], ["flat-map", "`flatMap`", "world.flatMap(body => [body])"],
  ["object-values", "Object.values", "Object.values({ a: world[0], b: world[1] })"], ["array-from", "Array.from", "Array.from(world)"], ["array-of", "Array.of", "Array.of(...world)"], ["to-sorted", "`toSorted`", "world.toSorted(() => 0)"],
  ["to-reversed", "`toReversed`", "world.toReversed()"], ["a-spread", "a spread in an array literal", "[...world]"], ["array-from-a-set", "Array.from over a Set", "Array.from(new Set(world))"], ["map-values", "a spread of the values of a Map", "[...new Map(world.map(body => [body.label, body])).values()]"],
];
for (const [slug, words, first] of FIRSTS) {
  built(
    `the-array-of-${slug}-gets-an-own-filter`,
    `The array that ${words} has made gets an own \`filter\`, which calls the callback with two strings. Then \`filter\` is called on it, and what comes out is used under the type of the instances.`,
    join(`const first: Body[] = ${first};`, "(first as any).filter = custom;", "seen.push(measure(first.filter(keep)), kinds.join());"), { pre: join(ALIKE, KEEP, CUSTOM) },
  );
  built(
    `the-array-of-${slug}-gets-an-own-constructor-with-a-species`,
    `The array that ${words} has made gets an own \`constructor\` whose Symbol.species is a class of the program. Then \`map\` is called on it, which constructs that class, and what comes out is used under the type of the instances.`,
    join(`const first: Body[] = ${first};`, "(first as any).constructor = { [Symbol.species]: Swapping };", "seen.push(measure(first.map(body => body)));"), { pre: join(ALIKE, SWAPPING) },
  );
}
const SECONDS: [string, string, string][] = [
  ["map", "`map`", "first.map(body => (keep(body, 0), body))"], ["for-each", "`forEach`", "(first.forEach(keep), first)"], ["a-for-of-loop", "a `for of` loop", "first"], ["a-spread", "a spread", "[...first]"], ["array-from", "Array.from", "Array.from(first)"],
  ["slice", "`slice`", "first.slice()"], ["concat", "`concat`", "([] as Body[]).concat(first)"], ["find", "`find`", "[first.find(() => true)!]"], ["reduce", "`reduce`", "first.reduce((all: Body[], body) => (all.push(body), all), [])"],
  ["destructuring", "an array pattern", "(([one, two]: Body[]) => [one, two])(first)"], ["an-index", "a read at an index", "[first[0], first[1]]"], ["at", "`at`", "[first.at(1)!]"], ["promise-all", "Promise.all", "await Promise.all(first)"], ["sort", "`sort`", "first.sort(() => 0)"],
];
for (const [slug, words, second] of SECONDS) {
  built(
    "a-getter-at-an-index-of-the-array-of-map-is-run-by-" + slug,
    `The array that \`map\` has made gets an accessor at an index, which stores a string into a number field of an instance and answers a look-alike. Then the array goes through ${words}, and what comes out is used under the type of the instances.`,
    join("const first = world.map(body => body);", 'Object.defineProperty(first, 1, { get: () => (((world[3] as any).mass = "9"), alike), set: () => {}, configurable: true });', attemptLines(`seen.push(measure(${second}), kinds.join());`)), { pre: join(ALIKE, KEEP) },
  );
}
built(
  "the-array-of-map-gets-an-own-iterator",
  "The array that `map` has made gets an own Symbol.iterator, which yields a look-alike; a `for of` loop, a spread and Array.from use it, `filter` does not.",
  join("const first = world.map(body => body);", "(first as any)[Symbol.iterator] = function* () {\n  yield alike;\n};", "seen.push(measure(first), measure([...first]), measure(Array.from(first)), measure(first.filter(keep)));"), { pre: join(ALIKE, KEEP) },
);
const INTEGRITY: [string, string][] = [["freeze", "frozen"], ["seal", "sealed"], ["preventExtensions", "made non-extensible"]];
const MUTATORS: [string, string][] = [["push", "first.push(world[0])"], ["pop", "first.pop()"], ["a-store-at-an-index", "first[0] = world[1]"], ["a-store-to-length", "first.length = 0"], ["sort", "first.sort(() => -1)"], ["reverse", "first.reverse()"], ["splice", "first.splice(0, 1)"], ["fill", "first.fill(world[2])"]];
for (const [how, words] of INTEGRITY) {
  built(
    `the-array-of-map-is-${{ freeze: "frozen", seal: "sealed", preventExtensions: "made-non-extensible" }[how]}-and-then-changed`,
    `The array that \`map\` has made is ${words}. Each method that changes an array, and each store, then either throws a TypeError or goes through; what the array holds afterwards tells which.`,
    join("const first = world.map(body => body);", `Object.${how}(first);`, MUTATORS.map(([name, code]) => attemptLines(`${code};\nseen.push("${name}");`)).join("\n"), "seen.push(measure(first));"),
  );
}
built(
  "the-array-of-map-gets-a-length-that-cannot-be-written",
  "The `length` of the array that `map` has made is made non-writable, so `push`, `pop` and a store behind the end throw a TypeError, and a store at an index goes through.",
  join("const first = world.map(body => body);", 'Object.defineProperty(first, "length", { writable: false });', [["push", "first.push(world[0])"], ["pop", "first.pop()"], ["behind the end", "first[9] = world[0]"], ["at an index", "first[0] = world[1]"]].map(([name, code]) => attemptLines(`${code};\nseen.push("${name}");`)).join("\n"), "seen.push(measure(first));"),
);

const PROMISE_CHANGES: [string, string, string, string[], boolean][] = [
  ["an-own-then", "gets an own `then`, which calls the reaction with a look-alike", "made.then = (react: (body: unknown) => unknown) => Promise.resolve(react(alike));", [], true],
  ["an-own-constructor-with-a-species", "gets an own `constructor` whose Symbol.species is a class of the program, which `then` constructs and which resolves with a look-alike whatever it is given", "made.constructor = { [Symbol.species]: Swapped };", [SWAPPED], true],
  ["another-prototype", "is put under the prototype object of a class of the program, whose `then` calls the reaction with a look-alike", "Object.setPrototypeOf(made, OtherPromise.prototype);", [OTHER_P], true],
  ["an-own-then-by-define-property", "gets an own `then` by Object.defineProperty", 'Object.defineProperty(made, "then", { value: (react: (body: unknown) => unknown) => Promise.resolve(react(alike)) });', [], false],
  ["an-own-then-by-object-assign", "gets an own `then` by Object.assign", "Object.assign(made, { then: (react: (body: unknown) => unknown) => Promise.resolve(react(alike)) });", [], false],
  ["an-own-then-under-a-computed-key", "gets an own `then` under a key that is put together at run time", 'made[["th", "en"].join("")] = (react: (body: unknown) => unknown) => Promise.resolve(react(alike));', [], false],
  ["no-prototype", "loses its prototype, so `then` is not found", "Object.setPrototypeOf(made, null);", [], false],
  ["another-prototype-by-the-proto-setter", "is put under the prototype object of a class of the program by a store to `__proto__`", "made.__proto__ = OtherPromise.prototype;", [OTHER_P], false],
  ["an-own-constructor-that-is-a-subclass", "gets an own `constructor` that is a subclass of Promise", "made.constructor = Swapped;", [SWAPPED], false],
];
const P_SECONDS: [string, string, string][] = [
  ["then", "`then` is called on it", "await first.then(onBody)"],
  ["await", "it is awaited", "onBody(await first)"],
  ["the-result-of-a-reaction", "a reaction returns it", "await Promise.resolve(0).then(() => first).then(onBody)"],
  ["an-async-return", "an async function returns it", "await (async () => first)().then(onBody)"],
  ["promise-all", "it goes through Promise.all", "onBody((await Promise.all([first]))[0])"],
  ["finally", "`finally` is called on it", "onBody(await first.finally(() => {}))"],
];
for (const [slug, words, change, needs, every] of PROMISE_CHANGES) {
  for (const [mode, modeWords, apply, helper] of MODES) {
    if (!every && mode !== "directly") {
      continue;
    }
    const code = helper ? change : change;
    built(
      `the-promise-of-promise-resolve-gets-${slug}-${mode}`,
      `The promise that Promise.resolve has made ${words}; that is done ${modeWords}. Then \`then\` is called on it, and what comes out is used under the type of the instances.`,
      join("const first = Promise.resolve(world[0]);", apply(change, "first").replaceAll("const list: any", "const made: any"), attemptLines("seen.push(measure([await first.then(onBody)]));"), "seen.push(kinds.join());"),
      { pre: join(ALIKE, ON_BODY, ...needs, helper ? `function change(made: any): void {\n  ${change}\n}` : "") },
    );
  }
}
for (const [slug, words, change, needs, every] of [...PROMISE_CHANGES.slice(0, 3), ...PROMISE_CHANGES.slice(6, 7)]) {
  for (const [secondSlug, secondWords, second] of P_SECONDS.slice(1)) {
    built(
      `the-promise-of-promise-resolve-gets-${slug}-and-${secondSlug}-sees-it`,
      `The promise that Promise.resolve has made ${words}. Then ${secondWords}, and what comes out is used under the type of the instances.`,
      join("const first = Promise.resolve(world[0]);", "const made: any = first;", change, attemptLines(`seen.push(measure([${second}]));`), "seen.push(kinds.join());"), { pre: join(ALIKE, ON_BODY, ...needs) },
    );
  }
}
const P_FIRSTS: [string, string, string][] = [
  ["new-promise", "`new Promise`", "new Promise<Body>(resolve => resolve(world[0]))"], ["then", "`then`", "Promise.resolve(0).then(() => world[0])"], ["catch", "`catch`", "Promise.reject(0).catch(() => world[0])"], ["finally", "`finally`", "Promise.resolve(world[0]).finally(() => {})"],
  ["an-async-function", "an async function", "(async () => world[0])()"], ["promise-race", "Promise.race", "Promise.race([world[0]])"], ["promise-any", "Promise.any", "Promise.any([world[0]])"], ["with-resolvers", "Promise.withResolvers", "((made = Promise.withResolvers<Body>()) => (made.resolve(world[0]), made.promise))()"],
];
for (const [slug, words, first] of P_FIRSTS) {
  built(
    `the-promise-of-${slug}-gets-an-own-then`,
    `The promise that ${words} has made gets an own \`then\`, which calls the reaction with a look-alike. Then \`then\` is called on it, and what comes out is used under the type of the instances.`,
    join(`const first: Promise<Body> = ${first};`, "(first as any).then = (react: (body: unknown) => unknown) => Promise.resolve(react(alike));", "seen.push(measure([await first.then(onBody)]), kinds.join());"), { pre: join(ALIKE, ON_BODY) },
  );
  built(
    `the-promise-of-${slug}-gets-an-own-constructor-with-a-species`,
    `The promise that ${words} has made gets an own \`constructor\` whose Symbol.species is a class of the program, which resolves with a look-alike whatever it is given. Then \`then\` is called on it, and what comes out is used under the type of the instances.`,
    join(`const first: Promise<Body> = ${first};`, "(first as any).constructor = { [Symbol.species]: Swapped };", "seen.push(measure([await first.then(onBody)]), kinds.join());"), { pre: join(ALIKE, ON_BODY, SWAPPED) },
  );
}

// 1. one call expression, several callees
const PICK = "const pick = <T>(list: T[], index: string): T => list[JSON.parse(index)];";
for (const [index, name] of ["map", "filter", "slice", "values", "entries", "keys", "flatMap"].entries()) {
  built(
    "one-call-under-a-name-chosen-at-run-time-" + ({ flatMap: "flat-map" }[name] ?? name),
    `One call expression calls a method of an array under a name that is chosen at run time among seven: some make an array, some an iterator. Here it is \`${name}\`. Then \`filter\` is called on the result, and what comes out is used under the type of the instances.`,
    join(`const name = pick(["map", "filter", "slice", "values", "entries", "keys", "flatMap"], "${index}");`, "const first = (world as any)[name]((body: Body) => body);", attemptLines("seen.push(measure([...first.filter(keep)]), Array.isArray(first));"), "seen.push(kinds.join());"), { pre: join(PICK, KEEP) },
  );
}
for (const [flag, name] of ["map", "flatMap"].entries()) {
  built(
    "one-call-of-map-or-flat-map-by-a-flag-" + ({ flatMap: "flat-map" }[name] ?? name),
    `One call expression calls \`map\` or \`flatMap\`, by a flag that is read at run time, with a callback that answers an array of a look-alike and an instance: \`map\` keeps the arrays, \`flatMap\` opens them. Here it is \`${name}\`.`,
    join(`const flag = JSON.parse("${flag}");`, "const first = (flag ? world.flatMap : world.map).call(world, (body: Body) => [alike, body]) as Body[];", attemptLines("seen.push(measure(first.filter(keep)));"), "seen.push(kinds.join());"), { pre: join(ALIKE, KEEP) },
  );
}
const LATER = `class Later {
  constructor(public held: unknown) {}
  then(react: (body: unknown) => unknown): unknown {
    return react(alike);
  }
  filter(test: (body: unknown, index: unknown) => boolean): unknown[] {
    test("text", "zero");
    return [alike];
  }
}`;
const MAKERS = ["Promise.resolve.bind(Promise)", "(value: unknown) => new Later(value)", "async (value: unknown) => value", "(value: unknown) => new Promise(resolve => resolve(value))"];
for (const [index, words] of ["Promise.resolve", "a closure that makes a thenable of the program", "an async function", "a closure that makes a promise"].entries()) {
  built(
    `one-call-of-a-maker-chosen-at-run-time-then-${index}`,
    `One call expression calls a function that is chosen at run time among four: Promise.resolve, a closure that makes a thenable of the program, an async function and a closure that makes a promise. Here it is ${words}. Then \`then\` is called on the result.`,
    join(`const make = pick<(value: unknown) => any>([${MAKERS.join(", ")}], "${index}");`, "const first = make(world[0]);", "seen.push(measure([await first.then(onBody)]), measure([onBody(await first)]), kinds.join());"), { pre: join(PICK, ALIKE, ON_BODY, LATER) },
  );
}
const A_MAKERS = ["Array.of", "(value: unknown) => [value]", "(value: unknown) => new Later(value)", "(value: unknown) => Array.from([value])", "(value: unknown) => new Set([value]).values()"];
for (const [index, words] of ["Array.of", "a closure with an array literal", "a closure that makes an object of the program with a `filter`", "a closure that calls Array.from", "a closure that answers the iterator of a Set"].entries()) {
  built(
    `one-call-of-a-maker-chosen-at-run-time-filter-${index}`,
    `One call expression calls a function that is chosen at run time among five, which make an array, an object of the program or an iterator. Here it is ${words}. Then \`filter\` is called on the result.`,
    join(`const make = pick<(value: unknown) => any>([${A_MAKERS.join(", ")}], "${index}");`, "const first = make(world[0]);", "seen.push(measure([...first.filter(keep)]), kinds.join());"), { pre: join(PICK, ALIKE, KEEP, LATER) },
  );
}
const CALL = "const call = (run: (...list: any[]) => any, ...list: unknown[]): any => run(...list);";
const ODD = `class Odd extends Array<unknown> {
  filter(test: (body: any, index: any, all: any) => unknown): any {
    test("text", "zero", this);
    return [alike];
  }
  forEach(visit: (body: any, index: any, all: any) => void): void {
    visit("text", "zero", this);
  }
  *[Symbol.iterator](): ArrayIterator<unknown> {
    yield alike;
  }
}`;
const THROUGH_CALL = 'const results: any[] = [call(Array.from, world), call(Object.values, { a: world[0] }), call(Array.of, world[1]), call((...list: unknown[]) => Odd.from(list), world[2]), call((mass: number) => [new Heavy(mass, "h")], 6)];';
for (const [slug, words, use] of [["filter", "`filter`", "seen.push(measure(result.filter(keep)));"], ["for-each", "`forEach`", "result.forEach(keep);"], ["a-for-of-loop", "a `for of` loop", "seen.push(measure(result));"], ["map", "`map`", "seen.push(measure(result.map((body: Body, index: number) => (keep(body, index), body))));"]]) {
  built(
    "one-helper-calls-every-maker-and-the-results-get-" + slug,
    `One helper calls whatever it is given: Array.from, Object.values, Array.of, a closure that makes an instance of a subclass of Array with methods of its own, and a closure with an array literal all pass through its one call expression. Each result then gets ${words}.`,
    join(THROUGH_CALL, `for (const result of results) {\n  ${use}\n}`, "seen.push(kinds.join());"), { pre: join(CALL, ALIKE, KEEP, ODD) },
  );
}
built(
  "one-helper-calls-every-maker-and-the-results-are-awaited",
  "One helper calls whatever it is given: Promise.resolve, Promise.all, an async function, a closure that makes a thenable of the program and a class constructor behind a closure all pass through its one call expression. Each result is then awaited and gets `then` where it has one.",
  join(
    'const results: any[] = [call(Promise.resolve.bind(Promise), world[0]), call(Promise.all.bind(Promise), [world[1]]), call(async () => world[2]), call((value: unknown) => new Later(value), world[3]), call((mass: number) => new Heavy(mass, "h"), 6)];',
    'for (const result of results) {\n  const out = await result;\n  seen.push(measure(Array.isArray(out) ? out : [onBody(out)]));\n  if (typeof result.then === "function") await result.then((value: Body) => (Array.isArray(value) ? value : onBody(value)));\n}', "seen.push(kinds.join());",
  ),
  { pre: join(CALL, ALIKE, ON_BODY, LATER) },
);

// Made by built-ins, the second half: subclasses, new.target, impostors, prototype objects between, results that meet, nested results.

// 3. subclasses
const GROUP = `let made = 0;
class Group extends Array<Body> {
  constructor(...list: any[]) {
    super(...list);
    made++;
  }
  filter(test: (body: any, index: any, all: any) => unknown): any {
    test("text", "zero", this);
    return [alike];
  }@MORE
}`;
function group(more = "") {
  return GROUP.replaceAll("@MORE", more ? "\n" + more.split("\n").map(line => "  " + line).join("\n") : "");
}
const G_FIRSTS: [string, string, string][] = [
  ["map", "`map`", "group.map(body => body)"], ["slice", "`slice`", "group.slice()"], ["concat", "`concat`", "group.concat([])"], ["flat", "`flat`", "group.flat()"], ["flat-map", "`flatMap`", "group.flatMap(body => [body])"],
  ["splice", "`splice`", "group.splice(0, 2)"], ["its-own-from", "`from` of the subclass", "Group.from(world)"], ["its-own-of", "`of` of the subclass", "Group.of(...world)"], ["the-generic-map", "Array.prototype.map, called with `call`", "Array.prototype.map.call(group, body => body)"],
  ["to-sorted", "`toSorted`, which always makes a plain array", "group.toSorted(() => 0)"], ["to-reversed", "`toReversed`, which always makes a plain array", "group.toReversed()"], ["with", "`with`, which always makes a plain array", "group.with(0, world[1])"],
  ["to-spliced", "`toSpliced`, which always makes a plain array", "group.toSpliced(0, 1)"], ["array-from", "Array.from, which makes a plain array", "Array.from(group)"], ["a-spread", "a spread, which makes a plain array", "[...group]"],
];
for (const [slug, words, first] of G_FIRSTS) {
  built(
    "a-subclass-of-array-goes-through-" + slug,
    `A subclass of Array overrides \`filter\`: the override calls the callback with two strings and answers a look-alike. An instance goes through ${words}, and \`filter\` is called on the result: whether the override runs depends on the class of that result.`,
    join("const group = Group.from(world);", `const first = ${first} as Body[];`, "seen.push(first instanceof Group, measure(first.filter(keep)), kinds.join(), made);"), { pre: join(ALIKE, KEEP, group()) },
  );
}
const FILLING = `let made = 0;
class Filling extends Array<Body> {
  constructor(...list: any[]) {
    super(...list);
    made++;
    if (typeof list[0] === "number") this[list[0]] = alike;
  }
}`;
for (const [slug, words, first] of [["map", "`map`", "filling.map(body => body)"], ["filter", "`filter`", "filling.filter(() => true)"], ["slice", "`slice`", "filling.slice(1)"], ["concat", "`concat`", "filling.concat([world[0]])"], ["flat", "`flat`", "filling.flat()"], ["flat-map", "`flatMap`", "filling.flatMap(body => [body])"], ["splice", "`splice`", "filling.splice(1, 2)"]]) {
  built(
    "the-constructor-of-a-subclass-of-array-fills-an-element-for-" + slug,
    `The constructor of a subclass of Array counts its calls and, where it is given a length, stores a look-alike behind that length. ${words[0].toUpperCase() + words.slice(1)} constructs the class, so what it answers with may hold an element that no callback has returned.`,
    join("const filling = Filling.from(world);", `const first = ${first};`, "seen.push(first.length, measure(first), measure(first.filter(keep)), kinds.join(), made);"), { pre: join(ALIKE, KEEP, FILLING) },
  );
}
for (const [slug, words, value, needs] of <[string, string, string, string[]][]>[["array", "Array", "Array", []], ["another-class", "another class of the program", "Swapping", [SWAPPING]], ["a-plain-function", "a plain function that answers an array with a look-alike in it", "function (length: number) {\n  return [alike, alike, alike, alike, alike];\n}", []], ["null", "null", "null", []], ["undefined", "undefined", "undefined", []]]) {
  built(
    "the-species-of-a-subclass-of-array-answers-" + slug,
    `The static Symbol.species getter of a subclass of Array answers ${words}, so that is what \`map\` constructs. \`filter\` is then called on the result: the override of the subclass runs only where the result is an instance of it.`,
    join("const group = Group.from(world);", "const first = group.map(body => body);", "seen.push(first instanceof Group, first.length, measure(first.filter(keep)), kinds.join(), made);"),
    { pre: join(ALIKE, KEEP, ...needs, group(`static get [Symbol.species](): any {\n  return ${value.replaceAll("\n", "\n  ")};\n}`)) },
  );
}
const WATCHED = `const under: any[] = [];
class Watched extends Array<Body> {
  constructor(...list: any[]) {
    super(...list);
    under.push(this);
  }
}`;
for (const [slug, words, change, needs] of [
  ["an-own-filter", "gives it an own `filter`", "under.at(-1).filter = custom;", [CUSTOM]],
  ["another-prototype", "puts it under the prototype object of another class", "Object.setPrototypeOf(under.at(-1), Other.prototype);", [CUSTOM, OTHER]],
  ["an-own-constructor-with-a-species", "gives it an own `constructor` with another Symbol.species", "under.at(-1).constructor = { [Symbol.species]: Swapping };", [SWAPPING]],
  ["prevent-extensions", "makes it non-extensible, so `map` throws a TypeError at the next element", "Object.preventExtensions(under.at(-1));", []],
  ["a-setter-less-accessor-at-a-later-index", "defines an accessor at a later index that cannot be redefined, so `map` throws a TypeError there", "Object.defineProperty(under.at(-1), 2, { get: () => alike });", []],
]) {
  built(
    "the-callback-of-map-reaches-the-result-and-gives-it-" + slug,
    `The constructor of a subclass of Array keeps every instance in a list, so the callback of \`map\` can reach the array that \`map\` is filling. At the first element it ${words}. Then \`filter\` is called on the result.`,
    join("const watched = Watched.from(world);", attemptLines(`const first = watched.map((body, index) => {\n  if (index === 0) ${change}\n  return body;\n});\nseen.push(measure(first.filter(keep)));`), "seen.push(kinds.join(), under.length);"), { pre: join(ALIKE, KEEP, ...needs, WATCHED) },
  );
}
const CHAINED = `let made = 0;
class Chained<T> extends Promise<T> {
  constructor(executor: (resolve: (value: T) => void, reject: (reason: unknown) => void) => void) {
    super(executor);
    made++;
  }
  then(react?: any, fail?: any): any {
    return super.then(react && (() => react(alike)), fail);
  }
}`;
for (const [slug, words, first] of [
  ["then", "`then`", "start.then((body: Body) => body)"], ["catch", "`catch`", "start.catch(() => world[1])"], ["finally", "`finally`", "start.finally(() => {})"], ["its-own-resolve", "`resolve` of the subclass", "Chained.resolve(world[0])"],
  ["its-own-all", "`all` of the subclass", "Chained.all([world[0]])"], ["its-own-race", "`race` of the subclass", "Chained.race([world[0]])"], ["promise-resolve-called-on-it", "Promise.resolve, called with the subclass as its receiver", "Promise.resolve.call(Chained, world[0])"],
  ["promise-all-called-on-it", "Promise.all, called with the subclass as its receiver", "(Promise.all as any).call(Chained, [world[0]])"], ["its-own-with-resolvers", "`withResolvers` of the subclass", "((pair = (Chained as any).withResolvers()) => (pair.resolve(world[0]), pair.promise))()"],
  ["promise-resolve", "Promise.resolve, which makes a plain promise that follows it", "Promise.resolve(start)"], ["an-async-function", "an async function that returns it, which makes a plain promise", "(async () => start as any)()"],
]) {
  built(
    "a-subclass-of-promise-goes-through-" + slug,
    `A subclass of Promise overrides \`then\`: the override hands the reaction a look-alike whatever the promise holds. A promise is made by ${words}, and \`then\` is called on it and it is awaited: whether the override runs depends on the class of that promise.`,
    join("const start = new Chained<Body>(resolve => resolve(world[0]));", `const first: any = ${first};`, "const out = await first.then((value: Body) => (Array.isArray(value) ? value[0] : onBody(value)));", "const awaited = await first;", "seen.push(first instanceof Chained, measure([out]), measure([Array.isArray(awaited) ? awaited[0] : awaited]), kinds.join(), made);"), { pre: join(ALIKE, ON_BODY, CHAINED) },
  );
}
built(
  "the-constructor-of-map-calls-the-set-of-a-subclass",
  "A subclass of Map overrides `set`: the override stores a look-alike whatever it is given. The constructor of Map calls it for each entry, so what `get`, `forEach` and a `for of` loop answer with are look-alikes.",
  join("const index = new Index(world.map(body => [body.label, body]));", 'const out: Body[] = [index.get("a")!];', "index.forEach(body => out.push(body));", "for (const [, body] of index) out.push(body);", "seen.push(index.size, measure(out), calls);"),
  { pre: join(ALIKE, CALLS, "class Index extends Map<string, Body> {\n  set(key: string, body: Body): this {\n    calls++;\n    return super.set(key, body instanceof Body ? alike : body);\n  }\n}") },
);
built(
  "the-constructor-of-set-calls-the-add-of-a-subclass",
  "A subclass of Set overrides `add`: the override stores a look-alike whatever it is given. The constructor of Set calls it for each element, so what a `for of` loop, `forEach` and a spread answer with are look-alikes.",
  join("const bag = new Bag(world);", "const out: Body[] = [...bag];", "bag.forEach(body => out.push(body));", "seen.push(bag.size, measure(out), calls);"),
  { pre: join(ALIKE, CALLS, "class Bag extends Set<Body> {\n  add(body: Body): this {\n    calls++;\n    return super.add(body instanceof Body ? alike : body);\n  }\n}") },
);
built(
  "a-subclass-of-map-overrides-get-and-for-each",
  "A subclass of Map overrides `get`, `forEach` and Symbol.iterator, which answer with look-alikes and strings; the built-in methods, called with `call`, answer with what the map really holds.",
  join("const index = new Index(world.map(body => [body.label, body]));", 'const out: Body[] = [index.get("a")!, Map.prototype.get.call(index, "a")];', "index.forEach(body => void keep(body, 0));", "for (const [, body] of index) out.push(body);", "seen.push(measure(out), kinds.join());"),
  { pre: join(ALIKE, KEEP, 'class Index extends Map<string, Body> {\n  get(key: string): Body {\n    return alike;\n  }\n  forEach(visit: (body: any, key: any, all: any) => void): void {\n    visit("text", 5, this);\n  }\n  *[Symbol.iterator](): MapIterator<[string, Body]> {\n    yield ["k", alike];\n  }\n}') },
);
built(
  "map-group-by-and-object-group-by-make-plain-containers",
  "Map.groupBy and Object.groupBy make a plain Map and an object without a prototype that hold plain arrays of the instances; one of those arrays gets an own `filter` before it is used.",
  join("const byClass = Map.groupBy(world, body => body.constructor);", 'const byLabel = Object.groupBy(world, body => (body.label.length > 1 ? "long" : "short"));', "(byClass.get(Heavy) as any).filter = custom;", "seen.push(measure(byClass.get(Heavy)!.filter(keep)), measure(byClass.get(Light)!.filter(keep)), measure(byLabel.short!.filter(keep)), Object.getPrototypeOf(byLabel), kinds.join());"), { pre: join(ALIKE, KEEP, CUSTOM) },
);

// 4. another new.target
built(
  "reflect-construct-makes-an-array-under-a-class-with-a-species",
  "Reflect.construct(Array, [], Other) makes a real array under the prototype object of a class of the program, whose static Symbol.species names another class. The built-in `push` and `filter` are called on it with `call`: `filter` constructs that other class.",
  join("const odd = Reflect.construct(Array, [], Under) as Body[];", "Array.prototype.push.call(odd, ...world);", "seen.push(Array.isArray(odd), typeof odd.filter, measure(Array.prototype.filter.call(odd, keep as any) as Body[]), kinds.join());"),
  { pre: join(ALIKE, KEEP, SWAPPING, "class Under {\n  static get [Symbol.species](): unknown {\n    return Swapping;\n  }\n}") },
);
built(
  "reflect-construct-makes-an-array-under-a-class-with-a-filter",
  "Reflect.construct(Array, [], Other) makes a real array under the prototype object of a class of the program that has a `filter` of its own, which a call by name finds; the built-in `filter`, called with `call`, makes a plain array.",
  join("const odd = Reflect.construct(Array, [], Other) as Body[];", "Array.prototype.push.call(odd, ...world);", "seen.push(Array.isArray(odd), measure(odd.filter(keep)), measure(Array.prototype.filter.call(odd, keep as any) as Body[]), kinds.join());"), { pre: join(ALIKE, KEEP, CUSTOM, OTHER) },
);
built(
  "reflect-construct-makes-a-promise-under-a-class-with-a-species",
  "Reflect.construct(Promise, [executor], Other) makes a real promise under the prototype object of a class of the program, whose static Symbol.species names a subclass of Promise. The built-in `then`, called with `call`, constructs that subclass, which resolves with a look-alike.",
  join("const odd = Reflect.construct(Promise, [(resolve: (body: Body) => void) => resolve(world[0])], Under) as Promise<Body>;", "seen.push(typeof odd.then, measure([(await Promise.prototype.then.call(odd, onBody as any)) as Body]), (await odd) === (odd as unknown), kinds.join());"),
  { pre: join(ALIKE, ON_BODY, SWAPPED, "class Under {\n  static get [Symbol.species](): unknown {\n    return Swapped;\n  }\n}") },
);
built(
  "reflect-construct-makes-a-promise-under-a-class-with-a-then",
  "Reflect.construct(Promise, [executor], Other) makes a real promise under the prototype object of a class of the program that has a `then` of its own, which a call by name and an `await` find.",
  join("const odd = Reflect.construct(Promise, [(resolve: (body: Body) => void) => resolve(world[0])], OtherPromise) as Promise<Body>;", "seen.push(measure([(await odd.then(onBody)) as Body]), measure([await Promise.resolve(0).then(() => odd)]), kinds.join());"), { pre: join(ALIKE, ON_BODY, OTHER_P.replaceAll("return react(alike);", 'return typeof react === "function" ? react(alike) : undefined;')) },
);
built(
  "reflect-construct-makes-a-map-under-a-class-with-a-set",
  "Reflect.construct(Map, [entries], Other) makes a real Map under the prototype object of a class of the program; the constructor of Map calls the `set` that it finds there, which stores a look-alike.",
  join("const odd = Reflect.construct(Map, [world.map(body => [body.label, body])], Under) as Map<string, Body>;", 'seen.push(typeof odd.get, measure([Map.prototype.get.call(odd, "a")]), Map.prototype.has.call(odd, "d"), calls);'),
  { pre: join(ALIKE, CALLS, "class Under {\n  set(key: string, body: Body): unknown {\n    calls++;\n    return Map.prototype.set.call(this, key, body instanceof Body ? alike : body);\n  }\n}") },
);
built(
  "reflect-construct-makes-a-set-under-a-class-with-an-add",
  "Reflect.construct(Set, [elements], Other) makes a real Set under the prototype object of a class of the program; the constructor of Set calls the `add` that it finds there, which stores a look-alike.",
  join("const odd = Reflect.construct(Set, [world], Under) as Set<Body>;", "const out: Body[] = [];", "Set.prototype.forEach.call(odd, body => out.push(body));", "seen.push(typeof odd.has, measure(out), calls);"),
  { pre: join(ALIKE, CALLS, "class Under {\n  add(body: Body): unknown {\n    calls++;\n    return Set.prototype.add.call(this, body instanceof Body ? alike : body);\n  }\n}") },
);

// 5. impostors: the right prototype, the wrong class
const FAKES: [string, string, string][] = [
  ["object-create", "Object.create(Array.prototype), filled with `push`", "const fake: any = Object.create(Array.prototype);\nfake.push(...world);"],
  ["a-literal-with-a-proto", "an object literal with `__proto__: Array.prototype`, a `length` and two elements", "const fake: any = { __proto__: Array.prototype, length: 2, 0: world[0], 1: world[1] };"],
  ["a-literal-with-a-length-that-is-a-string", "an object literal under Array.prototype whose `length` is a string", 'const fake: any = { __proto__: Array.prototype, length: "2", 0: world[0], 1: world[1], 2: alike };'],
  ["a-literal-with-a-length-that-is-an-object", "an object literal under Array.prototype whose `length` is an object with a `valueOf` that stores a string into a number field of an instance", 'const fake: any = { __proto__: Array.prototype, length: { valueOf: () => (((world[3] as any).mass = "9"), 2) }, 0: world[0], 1: world[1] };'],
  ["a-literal-with-a-getter-and-a-hole", "an object literal under Array.prototype with an accessor at one index and nothing at another", "const fake: any = { __proto__: Array.prototype, length: 3, 0: world[0], get 2() {\n  return alike;\n} };"],
  ["reflect-construct-of-object", "Reflect.construct(Object, [], Array), filled with `push`", "const fake: any = Reflect.construct(Object, [], Array);\nfake.push(...world);"],
  ["set-prototype-of", "a plain object that Object.setPrototypeOf has put under Array.prototype", "const fake: any = Object.setPrototypeOf({ length: 2, 0: alike, 1: world[1] }, Array.prototype);"],
];
for (const [slug, words, make] of FAKES) {
  built(
    "an-impostor-of-an-array-made-by-" + slug,
    `An object that lies under Array.prototype and is no array: ${words}. The methods of arrays work on it by name; Array.isArray, JSON.stringify and \`concat\` tell it from a real one. What comes out of \`filter\` and \`map\` is used under the type of the instances.`,
    join(make, "seen.push(Array.isArray(fake), fake instanceof Array, JSON.stringify(fake).length, ([] as unknown[]).concat(fake).length, fake.length);", attemptLines("seen.push(measure(fake.filter(keep)), measure(fake.map((body: Body) => body)), measure(fake), kinds.join());")), { pre: join(ALIKE, KEEP) },
  );
}
built(
  "an-impostor-of-a-promise",
  "Objects that lie under Promise.prototype and are no promises: `then`, `catch` and `finally` are found by name and throw a TypeError, and an `await` throws it on.",
  join("for (const fake of [Object.create(Promise.prototype), { __proto__: Promise.prototype }, Reflect.construct(Object, [], Promise)] as Promise<Body>[]) {", "  for (const run of [() => fake.then(onBody), () => fake.catch(() => 0), () => fake.finally(() => {})]) {\n    try {\n      seen.push(typeof run());\n    } catch (error) {\n      seen.push((error as Error).name);\n    }\n  }", "  seen.push(fake instanceof Promise, await (async () => typeof (await fake))().catch(error => (error as Error).name));", "}", "seen.push(kinds.length);"), { pre: ON_BODY },
);
built(
  "an-impostor-of-a-map-and-of-a-set",
  "Objects that lie under Map.prototype and Set.prototype and are neither: every method and the `size` accessor are found by name and throw a TypeError.",
  join("const fakes: any[] = [Object.create(Map.prototype), { __proto__: Map.prototype }, Reflect.construct(Object, [], Map), Object.create(Set.prototype), Reflect.construct(Object, [], Set)];", "for (const fake of fakes) {", '  for (const run of [() => fake.get?.("a"), () => fake.has("a"), () => fake.size, () => fake.forEach(keep), () => [...fake].length]) {\n    try {\n      seen.push(String(run()));\n    } catch (error) {\n      seen.push((error as Error).name);\n    }\n  }', "}", "seen.push(kinds.length);"), { pre: KEEP },
);

// 6. a prototype object between
const BETWEEN = "class Group extends Array<Body> {}";
built(
  "an-index-on-the-prototype-between-fills-the-holes",
  "The prototype object of a subclass of Array, which lies between its instances and Array.prototype, gets a look-alike at an index. A hole at that index in an instance, or in what `map` makes of one, reads the look-alike.",
  join("(Group.prototype as any)[1] = alike;", "const group = Group.from(world);", "delete group[1];", "const first = group.map(body => body);", "seen.push(1 in group, Object.hasOwn(group, 1), measure(group), measure(first), measure(first.filter(keep)), kinds.join());"), { pre: join(ALIKE, KEEP, BETWEEN) },
);
built(
  "an-accessor-at-an-index-on-the-prototype-between-takes-the-stores",
  "The prototype object of a subclass of Array gets an accessor at an index. A store at that index in an instance that has a hole there runs the setter and leaves the hole, and `push` does the same.",
  join("const stored: unknown[] = [];", "Object.defineProperty(Group.prototype, 4, { get: () => alike, set: value => void stored.push(value instanceof Body) });", "const group = Group.from(world);", "group[4] = world[0];", "seen.push(group.length, Object.hasOwn(group, 4));", "group.push(world[1]);", "seen.push(group.length, Object.hasOwn(group, 4), stored.join(), measure(group), measure(group.filter(keep)), kinds.join());"), { pre: join(ALIKE, KEEP, BETWEEN) },
);
built(
  "a-then-on-the-prototype-between-makes-arrays-thenables",
  "The prototype object of a subclass of Array gets a `then`, so an instance, and what `map` makes of one, are thenables: an `await` gives what the `then` resolves with.",
  join("(Group.prototype as any).then = function (this: Group, resolve: (value: unknown) => void): void {\n  resolve([alike]);\n};", "const group = Group.from(world);", "seen.push(measure((await group) as Body[]), measure((await group.map(body => body)) as Body[]), measure(await Array.from(group)));"), { pre: join(ALIKE, BETWEEN) },
);
built(
  "is-concat-spreadable-on-the-prototype-between",
  "The prototype object of a subclass of Array gets Symbol.isConcatSpreadable = false, so `concat` adds an instance as one element where it would open a plain array.",
  join("(Group.prototype as any)[Symbol.isConcatSpreadable] = false;", "const group = Group.from(world);", "const first = ([] as Body[]).concat(group, world.map(body => body));", "seen.push(first.length, measure(first), measure(first.filter(keep)), kinds.join());"), { pre: join(KEEP, BETWEEN) },
);
built(
  "a-method-on-the-prototype-between-is-added-late",
  "The prototype object of a subclass of Array gets a `filter` only after `map` has made the array on which `filter` is then called.",
  join("const group = Group.from(world);", "const first = group.map(body => body);", "seen.push(measure(first.filter(keep)));", "(Group.prototype as any).filter = custom;", "seen.push(measure(first.filter(keep)), kinds.join());"), { pre: join(ALIKE, KEEP, CUSTOM, BETWEEN) },
);

// 7. results that meet
const PARTNERS: [string, string, string, string[]][] = [
  ["an-instance-of-a-subclass", "an instance of a subclass of Array with a `filter` of its own", "Odd.from(world)", [ODD]],
  ["a-typed-array", "a typed array", "new Uint8Array(2)", []],
  ["a-hand-written-array", "an array literal that holds a look-alike", "[alike]", []],
  ["an-impostor", "an object under Array.prototype that is no array, with an accessor at an index", "{ __proto__: Array.prototype, length: 1, get 0() {\n  return alike;\n} }", []],
  ["a-proxy", "a proxy in front of an array, whose `get` trap answers a look-alike at every index", 'new Proxy([world[0]], { get: (target, key, receiver) => (key === "0" ? alike : Reflect.get(target, key, receiver)) })', []],
];
for (const [slug, words, partner, needs] of PARTNERS) {
  built(
    `the-array-of-map-meets-${slug}-in-one-parameter`,
    `One function calls \`filter\` on its parameter. It is given the array that \`map\` has made at one place and ${words} at another; what comes out is used under the type of the instances.`,
    join(`seen.push(second(world.map(body => body)), second(${partner} as any), kinds.join());`), { pre: join(ALIKE, KEEP, ...needs, "function second(list: Body[]): string {\n  return measure([...list.filter(keep)]);\n}") },
  );
  built(
    `the-array-of-map-meets-${slug}-in-one-variable`,
    `One variable holds the array that \`map\` has made or ${words}, by a flag that is read at run time. \`filter\` is called on it, and what comes out is used under the type of the instances.`,
    join('for (const flag of JSON.parse("[0,1]")) {', `  const list: Body[] = flag ? (${partner.replaceAll("\n", "\n  ")} as any) : world.map(body => body);`, "  seen.push(measure([...list.filter(keep)]));", "}", "seen.push(kinds.join());"), { pre: join(ALIKE, KEEP, ...needs) },
  );
  built(
    `the-array-of-map-meets-${slug}-in-one-field`,
    `One field holds the array that \`map\` has made first and ${words} afterwards. A function calls \`filter\` on what the field holds, and what comes out is used under the type of the instances.`,
    join("const holder = { list: world.map(body => body) };", "const second = (): string => measure([...holder.list.filter(keep)]);", "seen.push(second());", `holder.list = ${partner} as any;`, "seen.push(second(), kinds.join());"), { pre: join(ALIKE, KEEP, ...needs) },
  );
  built(
    `the-array-of-map-meets-${slug}-in-an-array-of-arrays`,
    `An array holds the array that \`map\` has made and ${words}. A loop calls \`filter\` on each, and what comes out is used under the type of the instances.`,
    join(`const lists: Body[][] = [world.map(body => body), ${partner} as any];`, "for (const list of lists) seen.push(measure([...list.filter(keep)]));", "seen.push(kinds.join());"), { pre: join(ALIKE, KEEP, ...needs) },
  );
}
built(
  "the-array-of-map-meets-an-arguments-object",
  "One function calls the built-in `filter` with `call` on its parameter. It is given the array that `map` has made at one place and an arguments object that holds a look-alike at another.",
  join("function gather(...ignored: unknown[]): IArguments {\n  return (function () {\n    return arguments;\n  })(...(ignored as []));\n}", "seen.push(second(world.map(body => body)), second(gather(alike, world[0])), kinds.join());"), { pre: join(ALIKE, KEEP, "function second(list: ArrayLike<Body>): string {\n  return measure(Array.prototype.filter.call(list, keep as any) as Body[]);\n}") },
);
for (const [slug, words, place] of [
  ["parameter", "One function calls `then` on its parameter and awaits it", "const second = async (made: any): Promise<void> => {\n  seen.push(measure([await made.then(onBody)]), measure([onBody(await made)]));\n};\nfor (const made of sources) await second(made);"],
  ["field", "One field holds each of them in turn, and a function calls `then` on what the field holds and awaits it", "const holder: { made: any } = { made: null };\nconst second = async (): Promise<void> => {\n  seen.push(measure([await holder.made.then(onBody)]), measure([onBody(await holder.made)]));\n};\nfor (const made of sources) {\n  holder.made = made;\n  await second();\n}"],
]) {
  built(
    "promises-of-four-makers-meet-in-one-" + slug,
    `${words}: a promise that Promise.resolve has made, the promise of an async function, an instance of a subclass of Promise with a \`then\` of its own, and a thenable of the program.`,
    join("const sources: any[] = [Promise.resolve(world[0]), (async () => world[1])(), new Chained<Body>(resolve => resolve(world[2])), new Later(world[3])];", place, "seen.push(kinds.join());"), { pre: join(ALIKE, ON_BODY, CHAINED, LATER) },
  );
}

// 8. nested results
const ASYNC_ALL = "const all = await Promise.all(world.map(async (body, index) => (index === 1 ? (alike as Body) : body)));";
for (const [slug, words, use] of [
  ["an-index", "read at an index", "[all[0], all[1]]"], ["an-array-pattern", "taken apart by an array pattern", "(([one, two]: Body[]) => [one, two])(all)"], ["a-chain-of-three", "sent through `map`, `filter` and `reduce`", "all.map(body => body).filter(keep).reduce((list: Body[], body) => (list.push(body), list), [])"],
  ["a-for-of-loop", "walked by a `for of` loop", "all"], ["a-second-promise-all", "sent through `map` and Promise.all once more", "await Promise.all(all.map(async body => body))"],
]) {
  built(
    "promise-all-over-the-promises-of-map-and-then-" + slug,
    `\`await Promise.all(world.map(async ..))\`: one of the async functions answers a look-alike under the type of the instances. The array that comes out is ${words}, and its elements are used with their fields and methods.`,
    join(ASYNC_ALL, `seen.push(measure(${use}), kinds.join());`), { pre: join(ALIKE, KEEP) },
  );
}
built(
  "the-records-of-all-settled-over-the-promises-of-map",
  "Promise.allSettled over the promises of `map`: one async function answers a look-alike, one throws an instance. The records are sent through `map`, and the values and reasons are used under the type of the instances.",
  join("const records = await Promise.allSettled(world.map(async (body, index) => {\n  if (index === 2) throw body;\n  return index === 1 ? (alike as Body) : body;\n}));", 'seen.push(measure(records.map(record => (record.status === "fulfilled" ? record.value : (record.reason as Body))).filter(keep)), kinds.join());'), { pre: join(ALIKE, KEEP) },
);
built(
  "the-pairs-of-object-entries",
  "Object.entries makes an array of pairs; one value is a look-alike under the type of the instances. The pairs are sent through `map` and `filter`, and the values are used with their fields and methods.",
  join("const table: Record<string, Body> = { a: world[0], b: alike, c: world[2] };", "seen.push(measure(Object.entries(table).map(([, body]) => body).filter(keep)), measure(Object.values(table)), kinds.join());"), { pre: join(ALIKE, KEEP) },
);
built(
  "the-pairs-of-the-entries-of-a-map",
  "Array.from over the entries of a Map makes an array of pairs; one value is a look-alike under the type of the instances. The pairs are sent through `map` and `filter`, and the values are used with their fields and methods.",
  join('const table = new Map<string, Body>([["a", world[0]], ["b", alike], ["c", world[2]]]);', "seen.push(measure(Array.from(table.entries()).map(([, body]) => body).filter(keep)), measure(Array.from(table.values())), measure([...table].map(pair => pair[1])), kinds.join());"), { pre: join(ALIKE, KEEP) },
);
built(
  "structured-clone-of-the-instances",
  "structuredClone answers under the type of what it was given, an array of instances, with an array of plain objects: the fields are there, the methods and the classes are not.",
  join("const copies = structuredClone(world);", "seen.push(measure(copies), copies.filter(keep).map(body => body.mass + body.at.x).join(), copies[0] instanceof Body, kinds.join());"), { pre: KEEP },
);
built(
  "json-parse-under-the-type-of-the-instances",
  "JSON.parse answers with plain objects, which a cast puts under the type of an array of instances; one of them has a string where the class has a number.",
  join(`const parsed = JSON.parse('[{"mass":1,"label":"a","at":{"x":1}},{"mass":"2","label":"b","at":{"x":"y"}}]') as Body[];`, "seen.push(measure(parsed), parsed.filter(keep).map(body => body.mass + body.at.x).join(), kinds.join());", "const untyped = JSON.parse(JSON.stringify(world));", "seen.push(untyped.map((body: Body) => body.mass + 1).filter((mass: number) => mass > 2).length);"), { pre: KEEP },
);
built(
  "the-callback-of-map-changes-the-array-it-walks",
  "The callback of `map` stores a look-alike into the array that `map` is walking, through its third argument, so a later element that it is given is the look-alike.",
  join("const source = world.slice();", "const first = source.map((body, index, all) => {\n  if (index === 0) all[2] = alike;\n  keep(body, index);\n  return body;\n});", "seen.push(measure(first), measure(first.filter(() => true)), kinds.join());"), { pre: join(ALIKE, KEEP) },
);
built(
  "the-callback-of-filter-shortens-the-array-it-walks",
  "The callback of `filter` shortens the array that `filter` is walking and puts a look-alike at its new end, so fewer elements are visited than the array had at the start.",
  join("const source = world.slice();", "const first = source.filter((body, index, all) => {\n  if (index === 0) {\n    all.length = 2;\n    all[1] = alike;\n  }\n  return keep(body, index);\n});", "seen.push(first.length, measure(first), kinds.join());"), { pre: join(ALIKE, KEEP) },
);

// 6, first half: the built-in prototype objects themselves. A compiled program keeps their members, the index-like keys and a few names closed and lets ordinary new names in.
built(
  "a-method-added-to-array-prototype-changes-its-receiver",
  "The program adds a method under a new name to Array.prototype. Called on the array that `map` has made, it stores a look-alike at an index of its receiver and gives it an own `filter`.",
  join("(Array.prototype as any).spoil = function (this: any): void {\n  this[1] = alike;\n  this.filter = custom;\n};", "const first = world.map(body => body);", "seen.push(measure(first.filter(keep)));", "(first as any).spoil();", "seen.push(measure(first), measure(first.filter(keep)), kinds.join());"), { pre: join(ALIKE, KEEP, CUSTOM) },
);
built(
  "a-getter-added-to-array-prototype-changes-its-receiver",
  "The program adds an accessor under a new name to Array.prototype. Read on the array that `map` has made, it puts its receiver under the prototype object of a class of the program.",
  join('Object.defineProperty(Array.prototype, "spoiled", {\n  get(this: unknown[]) {\n    return Object.setPrototypeOf(this, Other.prototype) === this;\n  },\n  configurable: true,\n});', "const first = world.map(body => body);", "seen.push(measure(first.filter(keep)), (first as any).spoiled, measure(first.filter(keep)), kinds.join());"), { pre: join(ALIKE, KEEP, CUSTOM, OTHER) },
);
built(
  "a-method-added-to-promise-prototype-changes-its-receiver",
  "The program adds a method under a new name to Promise.prototype, which would give its receiver an own `then`. A compiled program keeps Promise.prototype closed for every name, and the build refuses a store that it can see.",
  join("(Promise.prototype as any).spoil = function (this: any): void {\n  this.then = (react: (body: unknown) => unknown) => Promise.resolve(react(alike));\n};", "const first = Promise.resolve(world[0]);", "seen.push(measure([await first.then(onBody)]));", "(first as any).spoil();", "seen.push(measure([await first.then(onBody)]), kinds.join());"), { pre: join(ALIKE, ON_BODY) },
);
built(
  "a-method-added-to-object-prototype-changes-its-receiver",
  "The program adds a method under a new name to Object.prototype, which would store into whatever it is called on. A compiled program keeps Object.prototype closed for every name, and the build refuses a definition that it can see.",
  join('Object.defineProperty(Object.prototype, "spoil", {\n  value(this: any): void {\n    if (Array.isArray(this)) this[1] = alike;\n    else this.mass = "9";\n  },\n  configurable: true,\n});', "const first = world.map(body => body);", "(first as any).spoil();", "(world[0] as any).spoil();", "seen.push(measure(first.filter(keep)), kinds.join());"), { pre: join(ALIKE, KEEP) },
);
const REFUSED = "error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable\n";
for (const [slug, words, store, pre] of [
  ["filter-of-array-prototype-is-replaced", "replaces `filter` on Array.prototype", "(Array.prototype as any).filter = custom;", join(ALIKE, KEEP, CUSTOM)],
  ["then-of-promise-prototype-is-replaced", "replaces `then` on Promise.prototype", "(Promise.prototype as any).then = () => alike;", join(ALIKE, KEEP)],
]) {
  built(
    slug, `The program ${words}. The build refuses a store to a closed key of a built-in prototype object that it can see.`,
    join(store, "const first = world.map(body => body);", "delete first[1];", "seen.push(measure(first.filter(keep)), kinds.join());"), { pre },
  );
  filesWritten["made-by-builtins-" + slug + ".build-errors.txt"] = REFUSED;
}
for (const slug of ["a-method-added-to-promise-prototype-changes-its-receiver", "a-method-added-to-object-prototype-changes-its-receiver"]) {
  filesWritten["made-by-builtins-" + slug + ".build-errors.txt"] = REFUSED;
}
built(
  "an-index-is-stored-on-array-prototype",
  "The program stores a look-alike at an index of Array.prototype, which every hole of every array would read. A compiled program keeps the index-like keys of Array.prototype closed: the store throws a TypeError, and `filter` skips the hole.",
  join(attemptLines('(Array.prototype as any)[1] = alike;\nseen.push("stored");'), "const first = world.map(body => body);", "delete first[1];", "seen.push(measure(first.filter(keep)), kinds.join());"), { pre: join(ALIKE, KEEP) },
);
for (const kind of ["expected", "erased"]) {
  filesWritten[`made-by-builtins-an-index-is-stored-on-array-prototype.${kind}.txt`] = "9200/1400 TypeError 8400/1000 B,B,B 9200/1400 4434\n";
}
// REASONS: an instance travels as a reason (or is thrown), link by link, and the function that finally gets it changes it.
// One path a program: who throws or rejects -> 0 to 4 links -> who gets it -> what that one does to it.
// The second timer is set when the reactions have run, so a timer that one of them sets fires first however long they took.
const NAP = "await new Promise(resolve => setTimeout(() => setTimeout(resolve, 5), 0));";
const EFFECTS: Record<string, [string, string]> = {
  store: ["stores a string into a number field of it", 'caught.mass = "9";'],
  delete: ["deletes a field of it", "delete caught.mass;"],
  add: ["adds a property to it that shadows a method of its class", 'caught.weight = () => "w";'],
  prototype: ["puts it under the other subclass", "Object.setPrototypeOf(caught, Light.prototype);"],
  method: ["calls a method of it with a string where every other call passes a number", 'caught.grow("2");'],
  null: ["stores null into a field of it that holds an object everywhere else", "caught.at = null;"],
};
function spoil(effect = "store") {
  return `function spoil(caught: any): void {\n  ${EFFECTS[effect][1]}\n}`;
}
const GROW = "grow(by: number): void {\n  this.mass += by;\n}";

// slug, who, statements before, the expression of a promise that is rejected with world[0]
const SOURCES: [string, string, string, string][] = [
  ["the-first-reaction-of-then", "The first reaction of `then` throws an instance", "", "Promise.resolve(0).then(() => {\n  throw world[0];\n})"],
  ["the-second-reaction-of-then", "The second reaction of `then` throws an instance", "", "Promise.reject(0).then(undefined, () => {\n  throw world[0];\n})"],
  ["the-reaction-of-catch", "The reaction of `catch` throws an instance", "", "Promise.reject(0).catch(() => {\n  throw world[0];\n})"],
  ["the-reaction-of-finally", "The reaction of `finally` on a fulfilled promise throws an instance", "", "Promise.resolve(0).finally(() => {\n  throw world[0];\n})"],
  ["the-reaction-of-finally-on-a-rejected-promise", "The reaction of `finally` on a rejected promise throws an instance, which takes the place of the earlier reason", "", "Promise.reject(0).finally(() => {\n  throw world[0];\n})"],
  ["an-executor-that-throws", "The executor of `new Promise` throws an instance", "", "new Promise(() => {\n  throw world[0];\n})"],
  ["an-executor-that-rejects", "The executor of `new Promise` calls its reject function with an instance", "", "new Promise((resolve, reject) => reject(world[0]))"],
  ["an-executor-that-rejects-and-then-throws", "The executor of `new Promise` calls its reject function with an instance and then throws another, which nobody sees", "", "new Promise((resolve, reject) => {\n  reject(world[0]);\n  throw world[1];\n})"],
  ["an-async-function-that-throws", "An async function throws an instance", "", "(async () => {\n  throw world[0];\n})()"],
  ["an-async-function-that-throws-behind-an-await", "An async function throws an instance behind an `await`", "", "(async () => {\n  await null;\n  throw world[0];\n})()"],
  ["an-async-function-that-awaits-a-rejected-promise", "An async function awaits a promise that is rejected with an instance and does not catch", "", "(async () => {\n  await Promise.reject(world[0]);\n})()"],
  ["an-async-function-that-returns-a-rejected-promise", "An async function returns a promise that is rejected with an instance", "", "(async () => Promise.reject(world[0]))()"],
  ["an-async-function-whose-default-value-throws", "The default value of a parameter of an async function throws an instance", "", "(async (value = ((): number => {\n  throw world[0];\n})()) => value)()"],
  ["an-async-generator-that-throws", "An async generator throws an instance", "", "(async function* () {\n  throw world[0];\n})().next()"],
  ["an-async-generator-that-throws-behind-a-yield", "An async generator throws an instance behind a `yield`", "const generator = (async function* () {\n  yield 1;\n  throw world[0];\n})();\nawait generator.next();", "generator.next()"],
  ["an-async-generator-that-is-thrown-into", "`throw` of an async generator is given an instance, and the generator does not catch", "", "(async function* () {\n  yield 1;\n})().throw(world[0])"],
  ["an-async-arrow-as-a-reaction", "An async arrow function that is a reaction throws an instance", "", "Promise.resolve(0).then(async () => {\n  throw world[0];\n})"],
  ["a-reaction-that-returns-promise-reject", "A reaction returns Promise.reject of an instance", "", "Promise.resolve(0).then(() => Promise.reject(world[0]))"],
  ["a-reaction-that-returns-an-earlier-rejected-promise", "A reaction returns a promise that was rejected with an instance earlier", "const earlier = Promise.reject(world[0]);\nearlier.catch(() => {});", "Promise.resolve(0).then(() => earlier)"],
  ["a-reaction-that-returns-a-thenable-that-rejects", "A reaction returns a thenable whose `then` calls its second argument with an instance", "", "Promise.resolve(0).then(() => ({ then: (resolve: unknown, reject: (reason: unknown) => void) => reject(world[0]) }))"],
  ["a-reaction-that-returns-a-thenable-that-throws", "A reaction returns a thenable whose `then` throws an instance", "", "Promise.resolve(0).then(() => ({\n  then() {\n    throw world[0];\n  },\n}))"],
  ["promise-reject", "Promise.reject is given an instance", "", "Promise.reject(world[0])"],
  ["the-reject-of-with-resolvers", "The reject function of Promise.withResolvers is given an instance", "const pair = Promise.withResolvers<unknown>();\npair.reject(world[0]);", "pair.promise"],
  ["promise-try", "The function given to Promise.try throws an instance", "", "(Promise as any).try(() => {\n  throw world[0];\n})"],
  ["a-getter-of-then-that-throws", "Promise.resolve is given an object whose `then` is an accessor that throws an instance", "", "Promise.resolve({\n  get then(): unknown {\n    throw world[0];\n  },\n})"],
  ["a-timer-that-rejects", "A timer is given the reject function of an executor and an instance", "", "new Promise((resolve, reject) => setTimeout(reject, 0, world[0]))"],
  ["a-tick-that-rejects", "process.nextTick is given the reject function of an executor and an instance", "", "new Promise((resolve, reject) => process.nextTick(reject, world[0]))"],
  ["an-executor-that-resolves-with-a-rejected-promise", "The executor of `new Promise` resolves with a promise that is rejected with an instance", "", "new Promise(resolve => resolve(Promise.reject(world[0])))"],
  ["promise-resolve-of-a-thenable-that-rejects", "Promise.resolve is given a thenable whose `then` calls its second argument with an instance", "", "Promise.resolve({ then: (resolve: unknown, reject: (reason: unknown) => void) => reject(world[0]) })"],
  ["an-await-of-a-thenable-that-rejects", "An async function awaits a thenable whose `then` calls its second argument with an instance", "", "(async () => {\n  await ({ then: (resolve: unknown, reject: (reason: unknown) => void) => reject(world[0]) } as any);\n})()"],
];
// slug, words, what it needs, the expression over the promise before it
const LINKS: [string, string, string, (p: any) => string][] = [
  ["then-without-a-second-argument", "`then` without a second argument", "", p => `${p}.then(value => value)`],
  ["then-with-two-undefined", "`then(undefined, undefined)`", "", p => `${p}.then(undefined, undefined)`],
  ["finally", "`finally`", "", p => `${p}.finally(() => {})`],
  ["a-finally-that-returns-a-promise", "a `finally` whose reaction returns a promise", "", p => `${p}.finally(() => Promise.resolve(1))`],
  ["a-catch-that-rethrows", "a `catch` that throws what it got", "", p => `${p}.catch(reason => {\n  throw reason;\n})`],
  ["a-catch-that-returns-promise-reject", "a `catch` that returns Promise.reject of what it got", "", p => `${p}.catch(reason => Promise.reject(reason))`],
  ["an-await-that-is-not-caught", "an `await` in an async function that does not catch", "", p => `(async () => {\n  await ${p};\n})()`],
  ["an-async-return", "the `return` of an async function", "", p => `(async () => ${p})()`],
  ["an-async-return-await", "a `return await` of an async function", "", p => `(async () => await ${p})()`],
  ["an-async-catch-that-rethrows", "a catch clause in an async function that throws what it caught", "", p => `(async () => {\n  try {\n    return await ${p};\n  } catch (reason) {\n    throw reason;\n  }\n})()`],
  ["an-async-finally-block", "a `finally` block around an `await` in an async function", "", p => `(async () => {\n  try {\n    return await ${p};\n  } finally {\n    seen.push("finally");\n  }\n})()`],
  ["promise-resolve", "Promise.resolve", "", p => `Promise.resolve(${p})`],
  ["promise-all", "Promise.all", "", p => `Promise.all([1, ${p}])`],
  ["promise-race", "Promise.race", "", p => `Promise.race([${p}, new Promise(() => {})])`],
  ["the-errors-of-promise-any", "Promise.any, out of whose AggregateError it is taken and thrown again", "", p => `Promise.any([${p}]).catch(error => {\n  throw error.errors[0];\n})`],
  ["the-record-of-all-settled", "Promise.allSettled, out of whose record it is taken and thrown again", "", p => `Promise.allSettled([${p}]).then(([record]) => {\n  throw (record as PromiseRejectedResult).reason;\n})`],
  ["a-field", "a field of an object, into which the promise is put and out of which it is taken", "", p => `{ kept: ${p} }.kept`],
  ["an-array", "an array, into which the promise is put and out of which it is taken", "", p => `[${p}].at(0)!`],
  ["a-map", "a Map, into which the promise is put and out of which it is taken", "", p => `new Map([["k", ${p}]]).get("k")!`],
  ["a-subclass-of-promise", "a subclass of Promise, which follows it", "class Following<T> extends Promise<T> {}", p => `Following.resolve(${p}).then(value => value)`],
  ["a-for-await-loop", "a `for await` loop over an array of promises, in an async function that does not catch", "", p => `(async () => {\n  for await (const one of [${p}]) void one;\n})()`],
  ["an-async-generator", "an async generator that awaits it and does not catch", "", p => `(async function* () {\n  yield await ${p};\n})().next()`],
  ["a-yield-star", "a `yield*` of an async generator over an async generator that awaits it", "", p => `(async function* () {\n  yield* (async function* () {\n    yield await ${p};\n  })();\n})().next()`],
  ["a-resolve-function", "the resolve function of an executor", "", p => `new Promise(resolve => resolve(${p}))`],
  ["the-result-of-a-reaction", "a reaction that returns it", "", p => `Promise.resolve(0).then(() => ${p})`],
  ["a-thenable-that-hands-it-on", "a thenable of the program that hands both of its arguments to the `then` of the promise", "", p => `Promise.resolve({ then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => void ${p}.then(resolve, reject) })`],
];
// slug, who gets it, imports, statements over the last promise
const SINKS: [string, string, string, (p: any) => string][] = [
  ["catch", "the function given to `catch`", "", p => `await ${p}.catch(spoil);`],
  ["the-second-argument-of-then", "the second function given to `then`", "", p => `await ${p}.then(undefined, spoil);`],
  ["a-catch-clause-around-await", "the catch clause around an `await`", "", p => `try {\n  await ${p};\n} catch (caught) {\n  spoil(caught);\n}`],
  ["a-catch-clause-in-an-async-function", "the catch clause of an async function that awaits it", "", p => `await (async (waited: Promise<unknown>) => {\n  try {\n    await waited;\n  } catch (caught) {\n    spoil(caught);\n  }\n})(${p});`],
  ["an-unhandled-rejection-listener", 'the "unhandledRejection" listener of the process', "", p => `process.on("unhandledRejection", (reason, promise) => {\n  seen.push(promise instanceof Promise);\n  spoil(reason);\n});\nvoid ${p};\n${NAP}`],
  ["an-uncaught-exception-listener", 'a timer, which throws it, and so the "uncaughtException" listener of the process', "", p => `process.on("uncaughtException", spoil);\n${p}.catch(reason => {\n  setTimeout(() => {\n    throw reason;\n  }, 0);\n});\n${NAP}`],
  ["the-capture-callback", "a timer, which throws it, and so the function given to process.setUncaughtExceptionCaptureCallback", "", p => `process.setUncaughtExceptionCaptureCallback(spoil);\n${p}.catch(reason => {\n  setTimeout(() => {\n    throw reason;\n  }, 0);\n});\n${NAP}\nprocess.setUncaughtExceptionCaptureCallback(null);`],
  ["the-cause-of-an-error", "an Error that wraps it as its `cause`, out of which the next `catch` takes it, and", "", p => `await ${p}\n  .catch(reason => {\n    throw new Error("wrapped", { cause: reason });\n  })\n  .catch(error => spoil(error.cause));`],
  ["the-errors-of-an-aggregate-error", "the AggregateError of Promise.any, out of whose `errors` the next `catch` takes it, and", "", p => `await Promise.any([${p}]).catch(error => spoil(error.errors[0]));`],
  ["the-reason-of-a-record", "the record of Promise.allSettled, out of which the next reaction takes it, and", "", p => `await Promise.allSettled([${p}]).then(([record]) => spoil((record as PromiseRejectedResult).reason));`],
  ["a-suppressed-error", "a DisposableStack, whose SuppressedError holds it, out of which the catch clause takes it, and", "", p => `await ${p}.catch(reason => {\n  const stack = new DisposableStack();\n  stack.defer(() => {\n    throw reason;\n  });\n  stack.defer(() => {\n    throw 5;\n  });\n  try {\n    stack.dispose();\n  } catch (error) {\n    spoil((error as SuppressedError).error);\n  }\n});`],
  ["the-reason-of-a-signal", "an AbortController, out of whose signal it is read as the `reason`, and", "", p => `await ${p}.catch(reason => {\n  const controller = new AbortController();\n  controller.abort(reason);\n  spoil(controller.signal.reason);\n});`],
  ["an-error-listener-of-an-emitter", 'an emitter, which emits it as an "error", and so the listener', 'import { EventEmitter } from "node:events";', p => `const emitter = new EventEmitter().on("error", spoil);\nawait ${p}.catch(reason => emitter.emit("error", reason));`],
];
function steps(source: any, links: any[]) {
  const [slug, who, before, expression] = source;
  const lines = [...(before ? [before] : []), `const rejected: Promise<unknown> = ${expression};`];
  let name = "rejected";
  for (const [index, link] of links.entries()) {
    const following = links.length === 1 ? "passed" : `passed${index + 1}`;
    const text = link[3](name);
    lines.push(`const ${following}: Promise<unknown> = ${text.startsWith("{") ? "(" + text + ")" : text};`);
    name = following;
  }
  return [lines.join("\n"), name];
}
function reason(slug: string, source: any, links: any[], sink: any, effect = "store") {
  const [text, last] = steps(source, links);
  let through = "";
  if (links.length > 0) {
    through = " The rejection passes through " + links.map(link => link[1]).join(", then ") + ".";
  }
  let head = `${source[1]}.${through} In the end ${!sink[1].endsWith(", and") ? sink[1] : sink[1].slice(0, -5) + "; whoever takes it out"} gets the instance and ${EFFECTS[effect][0]}.`;
  head = !sink[1].endsWith(", and") ? head.replaceAll("gets the instance and", "gets the instance and") : head;
  program(
    "rejections-" + slug, head, text + "\n" + sink[3](last) + (effect === "method" ? "\nworld[1].grow(1);" : ""),
    { pre: [spoil(effect), ...[...new Set(links.filter(link => link[2]).map(link => link[2]))].sort()].filter(part => part).join("\n"), imports: sink[2], body: effect === "method" ? GROW : "" },
  );
}
const bySlug = table => Object.fromEntries(table.map(row => [row[0], row]));
const [S, L, K] = [bySlug(SOURCES), bySlug(LINKS), bySlug(SINKS)];

// every source, straight into `catch`, and once more through one `then` into a catch clause
for (const source of SOURCES) {
  reason(`from-${source[0]}-to-catch`, source, [], K["catch"]);
  reason(`from-${source[0]}-through-then-to-a-catch-clause`, source, [L["then-without-a-second-argument"]], K["a-catch-clause-around-await"]);
}
// every link, alone, behind three sources
for (const link of LINKS) {
  for (const source of ["promise-reject", "the-first-reaction-of-then", "an-async-function-that-throws"]) {
    reason(`from-${source}-through-${link[0]}`, S[source], [link], K["catch"]);
  }
}
// every sink, behind three sources
for (const sink of SINKS.slice(1)) {
  for (const source of ["promise-reject", "the-first-reaction-of-then", "an-async-function-that-throws"]) {
    reason(`from-${source}-to-${sink[0]}`, S[source], [], sink);
  }
}
// chains of two to four links, mixed: a fixed walk over the tables
let state = 12345;
function following(limit: number) {
  state = Number((BigInt(state) * 1103515245n + 12345n) % 2147483648n);
  return (state >> 8) % limit;
}
for (let number = 0; number < 36; number++) {
  const source = SOURCES[following(SOURCES.length)];
  const chosen: any[] = [];
  while (chosen.length < 2 + number % 3) {
    const link = LINKS[following(LINKS.length)];
    if (!chosen.includes(link)) {
      chosen.push(link);
    }
  }
  const sink = SINKS[following(5)];
  const slug = `from-${source[0]}-through-${chosen.map(link => link[0]).join("-and-")}-to-${sink[0]}`;
  if (slug.length > 215) {
    continue;
  }
  reason(slug, source, chosen, sink);
}
// every other thing that the one who gets it can do, on six paths
for (const effect of ["delete", "add", "prototype", "method", "null"]) {
  for (const [source, links, sink] of <[string, string[], string][]>[
    ["the-first-reaction-of-then", [], "catch"], ["an-async-function-that-throws", [], "a-catch-clause-around-await"], ["an-executor-that-rejects", ["finally"], "the-second-argument-of-then"],
    ["promise-reject", [], "an-unhandled-rejection-listener"], ["the-reaction-of-catch", ["promise-all"], "catch"], ["an-async-arrow-as-a-reaction", ["an-async-return-await"], "the-reason-of-a-record"],
  ]) {
    const words = { delete: "a-field-is-deleted", add: "a-property-is-added", prototype: "the-prototype-is-changed", method: "a-method-is-called-with-a-string", null: "null-is-stored" }[effect];
    reason(`${words}-from-${source}${links.map(link => "-through-" + link).join("")}-to-${sink}`, S[source], links.map(link => L[link]), K[sink], effect);
  }
}

// what is dropped on the way must not arrive
program(
  "rejections-an-executor-that-resolves-and-then-throws-rejects-nothing",
  "The executor of `new Promise` resolves and then throws an instance: the promise is fulfilled, the throw is dropped, and the function given to `catch` never runs.",
  "const settled = new Promise(resolve => {\n  resolve(1);\n  throw world[0];\n});\nseen.push(await settled.catch(spoil));", { pre: spoil() },
);
program(
  "rejections-a-catch-that-throws-another-instance",
  "A promise is rejected with one instance, and a `catch` on the way throws another: the function at the end gets the second and stores a string into a number field of it, and the first stays as it was.",
  "await Promise.reject(world[1])\n  .catch(() => {\n    throw world[3];\n  })\n  .catch(spoil);", { pre: spoil() },
);
program(
  "rejections-a-finally-that-throws-another-instance",
  "A promise is rejected with one instance, and a `finally` on the way throws another: the function at the end gets the second and stores a string into a number field of it, and the first stays as it was.",
  "await Promise.reject(world[1])\n  .finally(() => {\n    throw world[3];\n  })\n  .catch(spoil);", { pre: spoil() },
);
program(
  "rejections-a-race-between-two-instances",
  "Promise.race gets two promises that are rejected with two instances: the function at the end gets the first and stores a string into a number field of it, and the second stays as it was.",
  "const late = new Promise((resolve, reject) => setTimeout(reject, 1, world[1]));\nlate.catch(() => {});\nawait Promise.race([late, Promise.reject(world[3])]).catch(spoil);", { pre: spoil() },
);

// the reason of a signal, and who rejects with it
const SIGNAL = "const controller = new AbortController();\ncontroller.abort(world[0]);\nconst { signal } = controller;";
for (const [slug, words, imports, attack] of [
  ["is-read", "It is read as the `reason` of the signal", "", "spoil(signal.reason);"],
  ["is-thrown-by-throw-if-aborted", "`throwIfAborted` throws it", "", "try {\n  signal.throwIfAborted();\n} catch (caught) {\n  spoil(caught);\n}"],
  ["rejects-a-fetch", "`fetch` with that signal rejects with it", "", 'await fetch("http://127.0.0.1:1/", { signal }).catch(spoil);'],
  ["is-the-cause-of-the-rejection-of-events-once", "events.once with that signal rejects with an error whose `cause` it is", 'import { EventEmitter, once } from "node:events";', 'await once(new EventEmitter(), "e", { signal }).catch(error => spoil(error.cause));'],
  ["is-the-cause-of-the-rejection-of-a-timer", "setTimeout of node:timers/promises with that signal rejects with an error whose `cause` it is", 'import { setTimeout as sleep } from "node:timers/promises";', "await sleep(1000, undefined, { signal }).catch(error => spoil(error.cause));"],
  ["goes-on-to-abort-signal-any", "AbortSignal.any over that signal has it as its `reason`", "", "spoil(AbortSignal.any([signal]).reason);"],
  ["reaches-an-abort-listener", "A listener that was added before reads it from the target of the event", "", ""],
]) {
  if (slug === "reaches-an-abort-listener") {
    program(
      "rejections-the-reason-of-a-signal-" + slug, `An AbortController is aborted with an instance. ${words}, and a string is stored into a number field of it.`,
      'const controller = new AbortController();\ncontroller.signal.addEventListener("abort", event => spoil((event.target as AbortSignal).reason));\ncontroller.abort(world[0]);', { pre: spoil() },
    );
  } else {
    program("rejections-the-reason-of-a-signal-" + slug, `An AbortController is aborted with an instance. ${words}, and a string is stored into a number field of it.`, SIGNAL + "\n" + attack, { pre: spoil(), imports });
  }
}
for (const [slug, head, imports, attack] of [
  ["an-await-using-declaration", "The Symbol.asyncDispose method of a resource in an `await using` declaration throws an instance, and the catch clause around the block gets it", "", "try {\n  await using resource = {\n    async [Symbol.asyncDispose]() {\n      throw world[0];\n    },\n  };\n  void resource;\n} catch (caught) {\n  spoil(caught);\n}"],
  ["a-using-declaration-and-a-throw-in-the-block", "The Symbol.dispose method of a resource in a `using` declaration throws an instance while another value is on its way out of the block: the SuppressedError holds both, and the catch clause takes the instance out of it", "", "try {\n  using resource = {\n    [Symbol.dispose]() {\n      throw world[0];\n    },\n  };\n  void resource;\n  throw 5;\n} catch (error) {\n  spoil((error as SuppressedError).error);\n}"],
  ["the-suppressed-side-of-a-suppressed-error", "An instance is on its way out of a block when the Symbol.dispose method of a resource throws another value: the SuppressedError holds the instance as `suppressed`, and the catch clause takes it out", "", "try {\n  using resource = {\n    [Symbol.dispose]() {\n      throw 5;\n    },\n  };\n  void resource;\n  throw world[0];\n} catch (error) {\n  spoil((error as SuppressedError).suppressed);\n}"],
  ["an-async-disposable-stack", "A function deferred on an AsyncDisposableStack rejects with an instance, and `disposeAsync` rejects with it", "", "const stack = new AsyncDisposableStack();\nstack.defer(async () => {\n  throw world[0];\n});\nawait stack.disposeAsync().catch(spoil);"],
  ["an-emitter-that-captures-rejections", 'An async listener of an emitter that captures rejections throws an instance, and the "error" listener gets it', 'import { EventEmitter } from "node:events";', 'new EventEmitter({ captureRejections: true })\n  .on("e", async () => {\n    throw world[0];\n  })\n  .on("error", spoil)\n  .emit("e");\n' + NAP],
  ["the-pull-of-a-stream", "The `pull` of a ReadableStream throws an instance, and `read` rejects with it", "", "await new ReadableStream({\n  pull() {\n    throw world[0];\n  },\n})\n  .getReader()\n  .read()\n  .catch(spoil);"],
  ["the-error-of-a-stream-controller", "The controller of a ReadableStream is given an instance as its error, and `read` rejects with it", "", "await new ReadableStream({ start: controller => controller.error(world[0]) }).getReader().read().catch(spoil);"],
  ["the-cancel-of-a-stream", "`cancel` of a ReadableStream is given an instance, and the `cancel` of its source gets it", "", "await new ReadableStream({ cancel: spoil }).cancel(world[0]);"],
  ["the-abort-of-a-writable-stream", "`abort` of a WritableStream is given an instance, and the `abort` of its sink gets it", "", "await new WritableStream({ abort: spoil }).abort(world[0]);"],
  ["the-destroy-of-a-node-stream", '`destroy` of a Readable is given an instance, and the "error" listener gets it', 'import { Readable } from "node:stream";', 'new Readable({ read() {} }).on("error", spoil).destroy(world[0] as any);\n' + NAP],
  ["a-microtask-that-throws", 'A function given to queueMicrotask throws an instance, and the "uncaughtException" listener of the process gets it', "", 'process.on("uncaughtException", spoil);\nqueueMicrotask(() => {\n  throw world[0];\n});\n' + NAP],
  ["an-event-listener-that-throws", 'A listener of an EventTarget throws an instance, and the "uncaughtException" listener of the process gets it', "", 'process.on("uncaughtException", spoil);\nconst target = new EventTarget();\ntarget.addEventListener("e", () => {\n  throw world[0];\n});\ntarget.dispatchEvent(new Event("e"));\n' + NAP],
]) {
  program("rejections-" + slug, head + ", and stores a string into a number field of it.", attack, { pre: spoil(), imports });
}

// 4. synchronous twins
const CAUGHT = statement => `try {\n  ${statement.replaceAll("\n", "\n  ")}\n} catch (caught) {\n  spoil(caught);\n}`;
const THROWER = "const thrower = (): never => {\n  throw world[0];\n};";
for (let depth = 0; depth < 4; depth++) {
  const frames = depth ? Array.from({ length: depth + 1 }, (_, index) => index).map(index => `function frame${index}(): void {\n  ${index === depth ? "throw world[0];" : `frame${index + 1}();`}\n}`).join("\n") : "";
  program(`thrown-through-${depth}-frames`, `An instance is thrown through ${depth} function frames, and the catch clause stores a string into a number field of it.`, CAUGHT(depth ? "frame0();" : "throw world[0];"), { pre: join(spoil(), frames) });
}
const SYNC: [string, string, string, string][] = [
  ["a-finally-block", "An instance is thrown through a `finally` block", 'try {\n  throw world[0];\n} finally {\n  seen.push("finally");\n}', ""],
  ["a-catch-clause-that-rethrows", "An instance is thrown, caught and thrown again", "try {\n  throw world[0];\n} catch (first) {\n  throw first;\n}", ""],
  ["the-throw-of-a-generator-that-does-not-catch", "`throw` of a generator is given an instance, and the generator does not catch", "(function* () {\n  yield 1;\n})().throw(world[0]);", ""],
  ["a-generator-that-throws", "A generator throws an instance while a `for of` loop drives it", "for (const one of (function* () {\n  yield 1;\n  throw world[0];\n})()) void one;", ""],
  ["a-generator-driven-by-array-from", "A generator throws an instance while Array.from drives it", "Array.from((function* () {\n  throw world[0];\n})());", ""],
  ["a-generator-driven-by-a-spread", "A generator throws an instance while a spread drives it", "void [...(function* () {\n  throw world[0];\n})()];", ""],
  ["the-return-of-an-iterator-at-a-break", "The `return` method of an iterator throws an instance when a `break` leaves the loop", "for (const one of { [Symbol.iterator]: () => ({ next: () => ({ done: false, value: 1 }), return: thrower }) } as any) {\n  void one;\n  break;\n}", THROWER],
  ["the-next-of-an-iterator-under-new-map", "The `next` method of an iterator throws an instance while the constructor of Map drives it", "new Map({ [Symbol.iterator]: () => ({ next: thrower }) } as any);", THROWER],
  ["a-getter-under-json-stringify", "A getter throws an instance while JSON.stringify runs it", "JSON.stringify({ get a() {\n  return thrower();\n} });", THROWER],
  ["to-json-under-json-stringify", "A `toJSON` throws an instance while JSON.stringify runs it", "JSON.stringify({ a: { toJSON: thrower } });", THROWER],
  ["a-replacer-under-json-stringify", "A replacer throws an instance while JSON.stringify runs it", "JSON.stringify({ a: 1 }, thrower);", THROWER],
  ["a-reviver-under-json-parse", "A reviver throws an instance while JSON.parse runs it", 'JSON.parse("1", thrower);', THROWER],
  ["a-setter-under-object-assign", "A setter throws an instance while Object.assign runs it", "Object.assign({ set a(value: number) {\n  thrower();\n} }, { a: 1 });", THROWER],
  ["a-getter-under-object-assign", "A getter of a source throws an instance while Object.assign runs it", "Object.assign({}, { get a() {\n  return thrower();\n} });", THROWER],
  ["a-getter-under-a-spread", "A getter throws an instance while an object spread runs it", "void { ...{ get a() {\n  return thrower();\n} } };", THROWER],
  ["a-getter-under-structured-clone", "A getter throws an instance while structuredClone runs it", "structuredClone({ get a() {\n  return thrower();\n} });", THROWER],
  ["to-string-under-string", "A `toString` throws an instance while String runs it", "String({ toString: thrower });", THROWER],
  ["to-string-under-a-template", "A `toString` throws an instance while a template runs it", "void `${{ toString: thrower }}`;", THROWER],
  ["to-string-under-join", "A `toString` throws an instance while `join` runs it", "[{ toString: thrower }].join();", THROWER],
  ["to-string-under-a-property-key", "A `toString` throws an instance while a computed member access turns it into a key", "void ({} as any)[{ toString: thrower } as any];", THROWER],
  ["value-of-under-math-max", "A `valueOf` throws an instance while Math.max runs it", "Math.max({ valueOf: thrower } as any);", THROWER],
  ["value-of-under-an-operator", "A `valueOf` throws an instance while a multiplication runs it", "void (({ valueOf: thrower } as any) * 2);", THROWER],
  ["to-primitive-under-a-unary-plus", "A Symbol.toPrimitive method throws an instance while a unary plus runs it", "void +({ [Symbol.toPrimitive]: thrower } as any);", THROWER],
  ["to-primitive-under-new-date", "A Symbol.toPrimitive method throws an instance while the constructor of Date runs it", "new Date({ [Symbol.toPrimitive]: thrower } as any);", THROWER],
  ["a-comparator-under-sort", "A comparator throws an instance while `sort` runs it", "[2, 1].sort(thrower);", THROWER],
  ["a-callback-under-map", "A callback throws an instance while `map` runs it", "[1].map(thrower);", THROWER],
  ["a-callback-under-for-each", "A callback throws an instance while `forEach` runs it", "[1].forEach(thrower);", THROWER],
  ["a-callback-under-reduce", "A callback throws an instance while `reduce` runs it", "[1, 2].reduce(thrower);", THROWER],
  ["a-callback-under-find", "A callback throws an instance while `find` runs it", "[1].find(thrower);", THROWER],
  ["a-callback-under-flat-map", "A callback throws an instance while `flatMap` runs it", "[1].flatMap(thrower);", THROWER],
  ["a-mapper-under-array-from", "A mapper throws an instance while Array.from runs it", "Array.from([1], thrower);", THROWER],
  ["a-callback-under-a-typed-array", "A callback throws an instance while `map` of a typed array runs it", "new Uint8Array(1).map(thrower);", THROWER],
  ["a-callback-under-the-for-each-of-a-map", "A callback throws an instance while `forEach` of a Map runs it", "new Map([[1, 1]]).forEach(thrower);", THROWER],
  ["a-callback-under-the-for-each-of-a-set", "A callback throws an instance while `forEach` of a Set runs it", "new Set([1]).forEach(thrower);", THROWER],
  ["a-callback-under-replace", "A callback throws an instance while `replace` runs it", '"a".replace("a", thrower);', THROWER],
  ["a-callback-under-group-by", "A callback throws an instance while Object.groupBy runs it", "Object.groupBy([1], thrower);", THROWER],
  ["reflect-apply", "A function throws an instance while Reflect.apply runs it", "Reflect.apply(thrower, null, []);", THROWER],
  ["function-prototype-call", "A function throws an instance while Function.prototype.call runs it", "thrower.call(null);", THROWER],
  ["function-prototype-apply", "A function throws an instance while Function.prototype.apply runs it", "thrower.apply(null, []);", THROWER],
  ["a-bound-function", "A function throws an instance while a bound function runs it", "thrower.bind(null)();", THROWER],
  ["reflect-construct", "A constructor throws an instance while Reflect.construct runs it", "Reflect.construct(\n  class {\n    constructor() {\n      thrower();\n    }\n  },\n  [],\n);", THROWER],
  ["a-trap-of-a-proxy", "The `get` trap of a proxy throws an instance", "void new Proxy<any>({}, { get: thrower }).x;", THROWER],
  ["the-own-keys-trap-under-object-keys", "The `ownKeys` trap of a proxy throws an instance while Object.keys runs it", "Object.keys(new Proxy({}, { ownKeys: thrower }));", THROWER],
  ["has-instance", "A Symbol.hasInstance method throws an instance while `instanceof` runs it", "void ({} instanceof ({ [Symbol.hasInstance]: thrower } as any));", THROWER],
  ["a-species-getter-under-map", "A static Symbol.species getter throws an instance while `map` reads it", "(class extends Array<number> {\n  static get [Symbol.species](): any {\n    return thrower();\n  }\n})\n  .from([1])\n  .map(one => one);", THROWER],
  ["a-descriptor-getter-under-define-property", "A getter of a descriptor throws an instance while Object.defineProperty reads it", 'Object.defineProperty({}, "a", { get value() {\n  return thrower();\n} });', THROWER],
  ["a-listener-under-emit", "A listener throws an instance while `emit` runs it", 'new EventEmitter().on("e", thrower).emit("e");', THROWER],
  ["a-custom-inspect-method-under-inspect", "A custom inspect method throws an instance while util.inspect runs it", "inspect({ [inspect.custom]: thrower });", THROWER],
];
for (const [slug, words, statement, needs] of SYNC) {
  const imports = statement.includes("EventEmitter") ? 'import { EventEmitter } from "node:events";' : statement.includes("inspect(") ? 'import { inspect } from "node:util";' : "";
  program("thrown-through-" + slug, words + ". The catch clause outside gets the instance itself and stores a string into a number field of it.", CAUGHT(statement), { pre: join(spoil(), needs), imports });
}
program(
  "thrown-into-a-generator-that-catches",
  "`throw` of a generator is given an instance, and the catch clause inside the generator stores a string into a number field of it.",
  "const generator = (function* () {\n  try {\n    yield 1;\n  } catch (caught) {\n    spoil(caught);\n  }\n})();\ngenerator.next();\ngenerator.throw(world[0]);", { pre: spoil() },
);
program(
  "thrown-the-return-of-a-generator-hands-its-argument-back",
  "`return` of a generator is given an instance, runs the `finally` block of the generator and answers with a record that holds the instance; a string is stored into a number field of what the record holds.",
  'const generator = (function* () {\n  try {\n    yield 1;\n  } finally {\n    seen.push("finally");\n  }\n})();\ngenerator.next();\nspoil(generator.return(world[0] as any).value);', { pre: spoil() },
);
for (const effect of ["delete", "add", "prototype", "method", "null"]) {
  const words = { delete: "a-field-is-deleted", add: "a-property-is-added", prototype: "the-prototype-is-changed", method: "a-method-is-called-with-a-string", null: "null-is-stored" }[effect];
  for (const [slug, who, statement] of [["a-comparator-under-sort", "A comparator throws an instance while `sort` runs it", "[2, 1].sort(thrower);"], ["two-frames", "An instance is thrown through two function frames", "(() => (() => thrower())())();"]]) {
    program(`thrown-${words}-after-${slug}`, `${who}. The catch clause outside gets the instance itself and ${EFFECTS[effect][0]}.`, CAUGHT(statement) + (effect === "method" ? "\nworld[1].grow(1);" : ""), { pre: join(spoil(effect), THROWER), body: effect === "method" ? GROW : "" });
  }
}

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
