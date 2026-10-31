import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// The cases share the layers below them, so each writes on an object of its own and none puts a member back by a store.
const project = casesOfOneRun("a-test-replaces-a-member-through-a-proxy-that-a-helper-made", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

function runsAsPlain(
  title: string,
  expected: string,
  helpers: string,
  body: string,
  others: Record<string, string> = {},
) {
  const name = project.add(
    name => `
      import { beforeEach, test } from "bun:test";
      ${sayOf(name)}
      const replaced = () => "replaced";
      ${helpers}
      test("${name}", async () => {
        try {
          ${body}
        } catch (error) {
          say("threw", error.name);
        }
      });`,
    others,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain?.printed).toBe(expected + "\n");
    expect((await project.ran(["--debug-aot"], "TestRunLayers:2")).get(name)).toEqual(plain);
    expect((await project.ran(["--debug-aot"], "TestRunLayers:0")).get(name)).toEqual(plain);
  });
}

runsAsPlain(
  "an arrow function makes the proxy",
  "true replaced",
  `const wrap = object => new Proxy(object, {});`,
  `say((wrap(Math).hypot = replaced) === replaced, Math.hypot(3, 4));`,
);

runsAsPlain(
  "a function returns the proxy out of a variable, behind another return",
  "true replaced",
  `function wrap(object) {
        if (!object) return null;
        const proxy = new Proxy(object, {});
        return proxy;
      }`,
  `say((wrap(Atomics).load = replaced) === replaced, Atomics.load());`,
);

runsAsPlain(
  "the test keeps what the helper answers",
  "true replaced",
  `const wrap = object => new Proxy(object, {});`,
  `const kept = wrap(Date);
          say((kept.UTC = replaced) === replaced, Date.UTC());`,
);

runsAsPlain(
  "a hook keeps what the helper answers",
  "true replaced",
  `const wrap = object => new Proxy(object, {});
      let kept;
      beforeEach(() => {
        kept = wrap(BigInt);
      });`,
  `say((kept.asUintN = replaced) === replaced, BigInt.asUintN());`,
);

runsAsPlain(
  "the helper hands back the object itself",
  "true replaced",
  `const same = object => object;`,
  `say((same(Symbol).keyFor = replaced) === replaced, Symbol.keyFor());`,
);

runsAsPlain(
  "the helper lies in another file",
  "true replaced",
  `import { wrap } from "./helper.js";`,
  `say((wrap(String).raw = replaced) === replaced, String.raw());`,
  { "helper.js": `export const wrap = object => new Proxy(object, {});` },
);

runsAsPlain(
  "the helper is a method of an object, of a class and of an instance",
  "true replaced true replaced true replaced",
  `const tools = {
        wrap(object) {
          return new Proxy(object, {});
        },
      };
      class Tools {
        static wrap(object) {
          return new Proxy(object, {});
        }
        wrap(object) {
          return new Proxy(object, {});
        }
      }`,
  `say(
            (tools.wrap(Object).entries = replaced) === replaced,
            Object.entries(),
            (Tools.wrap(Reflect).has = replaced) === replaced,
            Reflect.has(),
            (new Tools().wrap(Promise).any = replaced) === replaced,
            Promise.any(),
          );`,
);

runsAsPlain(
  "a helper calls the helper twice",
  "true replaced",
  `const wrap = object => new Proxy(object, {});
      const twice = object => wrap(wrap(object));`,
  `say((twice(ArrayBuffer).isView = replaced) === replaced, ArrayBuffer.isView());`,
);

runsAsPlain(
  "the helper names the object, as a function and as a method",
  "true replaced true replaced",
  `const ofIntl = () => new Proxy(Intl, {});
      const tools = { ofJSON: () => new Proxy(JSON, {}) };`,
  `say(
            (ofIntl().getCanonicalLocales = replaced) === replaced,
            Intl.getCanonicalLocales(),
            (tools.ofJSON().rawJSON = replaced) === replaced,
            JSON.rawJSON("1"),
          );`,
);

runsAsPlain(
  "the helper takes the object out of its options",
  "true replaced",
  `const wrap = options => new Proxy(options.target, {});`,
  `say((wrap({ target: Number }).isSafeInteger = replaced) === replaced, Number.isSafeInteger(1));`,
);

runsAsPlain(
  "the helper answers an object that holds the proxy",
  "true replaced true replaced",
  `const make = object => ({ proxy: new Proxy(object, {}) });`,
  `const { proxy } = make(URL);
          say(
            (make(performance).proxy.now = replaced) === replaced,
            performance.now(),
            (proxy.canParse = replaced) === replaced,
            URL.canParse(),
          );`,
);

runsAsPlain(
  "the helper answers a list that holds the proxy",
  "true replaced true replaced",
  `const make = object => [new Proxy(object, {})];`,
  `const [proxy] = make(Map);
          say(
            (make(Array)[0].of = replaced) === replaced,
            Array.of(),
            (proxy.groupBy = replaced) === replaced,
            Map.groupBy(),
          );`,
);

runsAsPlain(
  "the helper is an async function",
  "true replaced",
  `const wrap = async object => new Proxy(object, {});`,
  `const proxy = await wrap(Buffer);
          say((proxy.isEncoding = replaced) === replaced, Buffer.isEncoding());`,
);

runsAsPlain(
  "Proxy.revocable() makes the proxy",
  "true replaced",
  ``,
  `say((Proxy.revocable(Error, {}).proxy.captureStackTrace = replaced) === replaced, Error.captureStackTrace());`,
);

runsAsPlain(
  "Object.defineProperty(), delete and Reflect.set() on what the helper answers",
  "replaced true undefined true replaced",
  `const wrap = object => new Proxy(object, {});`,
  `Object.defineProperty(wrap(Iterator), "from", { value: replaced, configurable: true, writable: true });
          say(
            Iterator.from(),
            delete wrap(Uint8Array).fromBase64,
            typeof Uint8Array.fromBase64,
            Reflect.set({}, "uptime", replaced, wrap(process)),
            process.uptime(),
          );`,
);

runsAsPlain(
  "the helper is handed a prototype, or the test goes on to one",
  "true replaced true replaced",
  `const wrap = object => new Proxy(object, {});`,
  `say(
            (wrap(String.prototype).anchor = replaced) === replaced,
            "a".anchor(),
            (wrap(RegExp).prototype.compile = replaced) === replaced,
            /a/.compile(),
          );`,
);

runsAsPlain(
  "a constructor returns the proxy: of a class, of the class above, of a function, of a class in another file",
  "true replaced true replaced true replaced true replaced",
  `import { ObservedElsewhere } from "./helper.js";
      class Observed {
        constructor(target) {
          return new Proxy(target, {});
        }
      }
      class ObservedBelow extends Observed {}
      function ObservedOld(target) {
        return new Proxy(target, {});
      }`,
  `say(
            (new Observed(Math).cbrt = replaced) === replaced,
            Math.cbrt(8),
            (new ObservedBelow(Reflect).ownKeys = replaced) === replaced,
            Reflect.ownKeys(),
            (new ObservedOld(Number).isInteger = replaced) === replaced,
            Number.isInteger(1),
            (new ObservedElsewhere(Object).values = replaced) === replaced,
            Object.values(),
          );`,
  {
    "helper.js": `export class ObservedElsewhere {
        constructor(target) {
          return new Proxy(target, {});
        }
      }`,
  },
);

runsAsPlain(
  "an instance keeps the proxy, from its constructor and in a field",
  "true replaced true replaced",
  `class Keeps {
        constructor(target) {
          this.proxy = new Proxy(target, {});
        }
      }
      class Holds {
        proxy = new Proxy(Intl, {});
      }`,
  `say(
            (new Keeps(BigInt).proxy.asIntN = replaced) === replaced,
            BigInt.asIntN(),
            (new Holds().proxy.supportedValuesOf = replaced) === replaced,
            Intl.supportedValuesOf(),
          );`,
);

runsAsPlain(
  "a method of a class names the object",
  "true replaced true replaced",
  `class Tools {
        static ofSet() {
          return new Proxy(Set.prototype, {});
        }
        ofWeakSet() {
          return new Proxy(WeakSet.prototype, {});
        }
      }`,
  `say(
            (Tools.ofSet().isSubsetOf = replaced) === replaced,
            new Set().isSubsetOf(),
            (new Tools().ofWeakSet().has = replaced) === replaced,
            new WeakSet().has(),
          );`,
);

runsAsPlain(
  "the helper calls back with the proxy",
  "true replaced true replaced",
  `import { withProxyElsewhere } from "./helper.js";
      function withProxy(object, use) {
        return use(new Proxy(object, {}));
      }`,
  `say(
            withProxy(Symbol, proxy => (proxy.for = replaced)) === replaced,
            Symbol.for(),
            withProxyElsewhere(String, ({ proxy }) => (proxy.fromCodePoint = replaced)) === replaced,
            String.fromCodePoint(),
          );`,
  { "helper.js": `export const withProxyElsewhere = (object, use) => use({ proxy: new Proxy(object, {}) });` },
);

runsAsPlain(
  "a getter makes the proxy",
  "true replaced",
  `const holder = {
        get proxy() {
          return new Proxy(DataView.prototype, {});
        },
      };`,
  `say((holder.proxy.getInt8 = replaced) === replaced, new DataView(new ArrayBuffer(1)).getInt8(0));`,
);

runsAsPlain(
  "the helper answers the function that makes the proxy",
  "true replaced true replaced",
  `const wrap = object => new Proxy(object, {});
      const makeWrap = target => () => new Proxy(target, {});`,
  `say(
            (makeWrap(Array)().fromAsync = replaced) === replaced,
            Array.fromAsync(),
            (wrap.bind(null, JSON)().isRawJSON = replaced) === replaced,
            JSON.isRawJSON(),
          );`,
);

runsAsPlain(
  "a promise hands the proxy to then()",
  "true replaced",
  `const wrap = object => new Proxy(object, {});`,
  `await Promise.resolve(wrap(Promise)).then(proxy => say((proxy.allSettled = replaced) === replaced, Promise.allSettled()));`,
);

runsAsPlain(
  "map() makes a list of proxies",
  "true replaced\ntrue replaced",
  `const wrap = object => new Proxy(object, {});`,
  `const list = [Atomics].map(wrap);
          say((list[0].notify = replaced) === replaced, Atomics.notify());
          for (const proxy of [URL].map(each => wrap(each))) say((proxy.parse = replaced) === replaced, URL.parse());`,
);

runsAsPlain(
  "another file names the object: in a function, in a constant, in what it exports by default",
  "true replaced true replaced true replaced",
  `import byDefault, { ofWeakRef, proxyOfWeakMap } from "./helper.js";`,
  `say(
            (ofWeakRef().prototype.deref = replaced) === replaced,
            WeakRef.prototype.deref(),
            (proxyOfWeakMap.prototype.getOrInsert = replaced) === replaced,
            new WeakMap().getOrInsert(),
            (byDefault.proxy.prototype.transfer = replaced) === replaced,
            new ArrayBuffer(1).transfer(),
          );`,
  {
    "helper.js": `export const ofWeakRef = () => new Proxy(WeakRef, {});
      export const proxyOfWeakMap = new Proxy(WeakMap, {});
      export default { proxy: new Proxy(ArrayBuffer, {}) };`,
  },
);

runsAsPlain(
  "another file names the object, and a third exports it again",
  "true replaced true replaced",
  `import * as helpers from "./helpers/index.js";`,
  `const kept = helpers.ofFinalizationRegistry();
          say(
            (kept.prototype.unregister = replaced) === replaced,
            FinalizationRegistry.prototype.unregister(),
            helpers.withProxy(proxy => (proxy.fromEntries = replaced)) === replaced,
            Object.fromEntries(),
          );`,
  {
    "helpers/index.js": `export * from "./one.js";
      export { withProxy } from "./other.js";`,
    "helpers/one.js": `export function ofFinalizationRegistry() {
        return new Proxy(FinalizationRegistry, {});
      }`,
    "helpers/other.js": `export const withProxy = use => use(new Proxy(Object, {}));`,
  },
);
