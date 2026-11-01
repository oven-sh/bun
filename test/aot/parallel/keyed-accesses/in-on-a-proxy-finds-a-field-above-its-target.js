// `in` on a proxy without a `has` trap asks the target, which answers from its prototype chain. Nothing else reads the fields up there, and each form has a field name of its own, so no form keeps the field of another.
const forms = {
  setPrototypeOf() {
    const target = {};
    Object.setPrototypeOf(target, { a1: 1, __proto__: null });
    return "a1" in new Proxy(target, {});
  },
  reflectSetPrototypeOf() {
    const target = {};
    Reflect.setPrototypeOf(target, { a2: 1, __proto__: null });
    return "a2" in new Proxy(target, {});
  },
  protoInLiteral() {
    return "a3" in new Proxy({ __proto__: { a3: 1, __proto__: null } }, {});
  },
  protoStored() {
    const target = {};
    target.__proto__ = { a4: 1, __proto__: null };
    return "a4" in new Proxy(target, {});
  },
  create() {
    return "a5" in new Proxy(Object.create({ a5: 1, __proto__: null }), {});
  },
  keyNobodyKnows() {
    const target = {};
    Object.setPrototypeOf(target, { a6: 1, __proto__: null });
    return JSON.parse('"a6"') in new Proxy(target, {});
  },
  twoAbove() {
    const top = { a7: 1, __proto__: null };
    const target = {};
    Object.setPrototypeOf(target, { __proto__: top });
    return "a7" in new Proxy(target, {});
  },
  instanceAbove() {
    class Above {
      constructor() {
        this.a8 = 1;
      }
    }
    const target = {};
    Object.setPrototypeOf(target, new Above());
    return "a8" in new Proxy(target, {});
  },
  proxyOfProxy() {
    const target = {};
    Object.setPrototypeOf(target, { a9: 1, __proto__: null });
    return "a9" in new Proxy(new Proxy(target, {}), {});
  },
  proxyAboveTheTarget() {
    const target = {};
    Object.setPrototypeOf(target, new Proxy({ __proto__: { a10: 1, __proto__: null } }, {}));
    return "a10" in new Proxy(target, {});
  },
  belowTheProxy() {
    const target = {};
    Object.setPrototypeOf(target, { a11: 1, __proto__: null });
    return "a11" in Object.create(new Proxy(target, {}));
  },
  revocable() {
    const target = {};
    Object.setPrototypeOf(target, { a12: 1, __proto__: null });
    return "a12" in Proxy.revocable(target, {}).proxy;
  },
  reflectHas() {
    const target = {};
    Object.setPrototypeOf(target, { a13: 1, __proto__: null });
    return Reflect.has(new Proxy(target, {}), "a13");
  },
  trapThatHandsOn() {
    const target = {};
    Object.setPrototypeOf(target, { a14: 1, __proto__: null });
    return "a14" in new Proxy(target, { has: (object, name) => Reflect.has(object, name) });
  },
  handlerFilledLater() {
    const target = {};
    Object.setPrototypeOf(target, { a15: 1, __proto__: null });
    const handler = {};
    const proxy = new Proxy(target, handler);
    const before = "a15" in proxy;
    handler.has = () => false;
    return [before, "a15" in proxy].join();
  },
  absent() {
    const target = {};
    Object.setPrototypeOf(target, { a16: 1, __proto__: null });
    return "b" in new Proxy(target, {});
  },
};
for (const [form, ask] of Object.entries(forms)) console.log(form, ask());
