// `this.name = value` creates an own field only while nothing on the prototype chain intercepts the store. Each scene
// builds objects a few or many times, then changes the chain so that a setter, a read-only property or a proxy is now
// in the way (added, or uncovered by a delete), and builds more objects with the same code.
import type { Random } from "./random";

type Chain = { declare: string; make: string; near: string; far: string };

/** Ways to build an object below two prototype objects. STORE is the statement that stores `value` in IT. */
const chains: Record<string, (id: number) => Chain> = {
  "a derived class": id => ({
    declare: `class Far${id} {}\nclass Near${id} extends Far${id} {\n  constructor(value) {\n    super();\n    const it = this;\n    STORE\n  }\n}`,
    make: `new Near${id}(VALUE)`,
    near: `Near${id}.prototype`,
    far: `Far${id}.prototype`,
  }),
  "a constructor function": id => ({
    declare: `function Far${id}() {}\nfunction Near${id}(value) {\n  const it = this;\n  STORE\n}\nObject.setPrototypeOf(Near${id}.prototype, Far${id}.prototype);`,
    make: `new Near${id}(VALUE)`,
    near: `Near${id}.prototype`,
    far: `Far${id}.prototype`,
  }),
  "Object.create": id => ({
    declare: `const far${id} = {};\nconst near${id} = Object.create(far${id});\nfunction make${id}(value) {\n  const it = Object.create(near${id});\n  STORE\n  return it;\n}`,
    make: `make${id}(VALUE)`,
    near: `near${id}`,
    far: `far${id}`,
  }),
  "a literal with __proto__": id => ({
    declare: `const far${id} = {};\nconst near${id} = { __proto__: far${id} };\nfunction make${id}(value) {\n  const it = { __proto__: near${id}, first: 1 };\n  STORE\n  return it;\n}`,
    make: `make${id}(VALUE)`,
    near: `near${id}`,
    far: `far${id}`,
  }),
  "a method": id => ({
    declare: `class Far${id} {}\nclass Near${id} extends Far${id} {\n  fill(value) {\n    const it = this;\n    STORE\n    return this;\n  }\n}`,
    make: `new Near${id}().fill(VALUE)`,
    near: `Near${id}.prototype`,
    far: `Far${id}.prototype`,
  }),
  "a class field": id => ({
    // A field is defined, not assigned, so nothing on the chain can intercept it. The store after it can be.
    declare: `class Far${id} {}\nclass Near${id} extends Far${id} {\n  first = 1;\n  constructor(value) {\n    super();\n    const it = this;\n    STORE\n  }\n}`,
    make: `new Near${id}(VALUE)`,
    near: `Near${id}.prototype`,
    far: `Far${id}.prototype`,
  }),
};

const stores = [
  "it.KEY = value;",
  'it["KEY"] = value;',
  "it.KEY = value;\n    it.other = 2;",
  "it.other = 2;\n    it.KEY = value;",
  "Object.assign(it, { KEY: value });",
  "({ KEY: it.KEY } = { KEY: value });",
  "it.KEY ??= value;",
  'Reflect.set(it, "KEY", value);',
  'for (const key of ["KEY"]) it[key] = value;',
];

const setter = (where: string) => `set(given) { log.push("${where} setter " + given); }, configurable: true`;

/** Statements that put something in the way of a store of KEY, or take it away. NEAR is below FAR. */
const changes = [
  "delete NEAR.KEY;",
  "delete FAR.KEY;",
  `Object.defineProperty(NEAR, "KEY", { ${setter("near")} });`,
  `Object.defineProperty(FAR, "KEY", { ${setter("far")} });`,
  'Object.defineProperty(NEAR, "KEY", { value: "fixed", writable: false, configurable: true });',
  'Object.defineProperty(FAR, "KEY", { value: "fixed", writable: false, configurable: true });',
  'Object.defineProperty(NEAR, "KEY", { get() { return "got"; }, configurable: true });',
  'Object.defineProperty(FAR, "KEY", { get() { return "got"; }, configurable: true });',
  `Object.setPrototypeOf(NEAR, { set KEY(given) { log.push("new parent's setter " + given); } });`,
  `Object.setPrototypeOf(FAR, { set KEY(given) { log.push("new grandparent's setter " + given); } });`,
  'Object.setPrototypeOf(FAR, new Proxy({}, { set(target, key, given, receiver) { log.push("trap " + String(key)); return Reflect.set(target, key, given, receiver); } }));',
  'Object.setPrototypeOf(NEAR, new Proxy({}, { set(target, key) { log.push("refusing trap " + String(key)); return false; } }));',
  'NEAR.KEY = "plain";',
  'FAR.KEY = "plain";',
  "Object.freeze(NEAR);",
  "Object.freeze(FAR);",
  "Object.setPrototypeOf(NEAR, null);",
];

/** What lies on the chain before the first object is built. */
const starts = [
  "",
  "",
  'NEAR.KEY = "plain";',
  'FAR.KEY = "plain";',
  `Object.defineProperty(FAR, "KEY", { ${setter("far")} });\nObject.defineProperty(NEAR, "KEY", { value: "plain", writable: true, configurable: true });`,
  'Object.defineProperty(FAR, "KEY", { value: "fixed", writable: false, configurable: true });\nObject.defineProperty(NEAR, "KEY", { value: "plain", writable: true, enumerable: true, configurable: true });',
  `Object.defineProperty(NEAR, "KEY", { ${setter("near")} });`,
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let id = 0, count = random.between(2, 5); id < count; id++) {
    const key = random.pick(["url", "name", "size", "then", "length", "0"]);
    const chain = random.pick(Object.values(chains))(id);
    const named = (text: string) =>
      text
        .replaceAll("NEAR", chain.near)
        .replaceAll("FAR", chain.far)
        .replaceAll(".KEY", /^\d/.test(key) ? `[${key}]` : `.${key}`)
        .replaceAll("KEY", key);
    const before = random.pick([0, 1, 3, 40, 400]);
    const steps = random.sample(changes, random.between(1, 3));
    const build = (value: string) => `show(${id}, build${id}(${value}));`;
    scenes.push(
      [
        named(chain.declare.replace("STORE", random.pick(stores))),
        `function build${id}(value) {\n  try {\n    return ${chain.make.replace("VALUE", "value")};\n  } catch (error) {\n    log.push(error.name);\n    return null;\n  }\n}`,
        named(random.pick(starts)),
        before ? `for (let i = 0; i < ${before}; i++) build${id}(i);\nlog.length = 0;` : "",
        build('"before"'),
        random.chance(0.5) ? `const kept${id} = build${id}("kept");\nlog.length = 0;` : "",
        ...steps.flatMap((step, at) => [
          `try {\n  ${named(step)}\n} catch (error) {\n  log.push("the change threw " + error.name);\n}`,
          build(`"after ${at}"`),
          random.chance(0.4) ? `for (let i = 0; i < 3; i++) ${build("i")}` : "",
        ]),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (scenes.at(-1)!.includes(`const kept${id}`))
      scenes.push(
        named(
          `try {\n  kept${id}.KEY = "again";\n} catch (error) {\n  log.push(error.name);\n}\nshow(${id}, kept${id});`,
        ),
      );
  }
  return `const log = [];
function show(scene, made) {
  const own = made === null ? "none" : Reflect.ownKeys(made).map(key => String(key) + "=" + String(made[key])).join();
  console.log(scene, own, "|", log.join());
  log.length = 0;
}
${scenes.join("\n")}
`;
}
