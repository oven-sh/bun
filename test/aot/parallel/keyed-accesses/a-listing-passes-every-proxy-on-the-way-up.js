// A listing or a test that starts at a proxy goes on to its target, up the target's chain, and through any proxy it meets there.
// Nothing else reads the fields at the top, and each form has field names of its own, so no form keeps the fields of another.
const count = object => {
  let found = 0;
  for (const key in object) found++;
  return found;
};
const forms = {
  proxyAboveTheTargetOfAProxy: () =>
    count(new Proxy(Object.setPrototypeOf({}, new Proxy({ __proto__: { a1: 1, b1: 2, __proto__: null } }, {})), {})),
  threeProxies: () =>
    count(
      new Proxy(
        Object.setPrototypeOf(
          {},
          new Proxy(Object.setPrototypeOf({}, new Proxy({ __proto__: { a2: 1, b2: 2, __proto__: null } }, {})), {}),
        ),
        {},
      ),
    ),
  proxyOfProxyThenAbove: () =>
    count(new Proxy(new Proxy(Object.setPrototypeOf({}, new Proxy({ __proto__: { a3: 1, __proto__: null } }, {})), {}), {})),
  created: () => count(new Proxy(Object.create(new Proxy(Object.create({ a4: 1, b4: 2, __proto__: null }), {})), {})),
  instanceAtTheTop: () => {
    class Top {
      a5 = 1;
      b5 = 2;
    }
    return count(new Proxy(Object.setPrototypeOf({}, new Proxy(Object.setPrototypeOf({}, new Top()), {})), {}));
  },
  keysInOrder: () => {
    const listed = [];
    for (const key in new Proxy(Object.setPrototypeOf({ own6: 0 }, new Proxy({ mid6: 1, __proto__: { a6: 1, b6: 2, __proto__: null } }, {})), {}))
      listed.push(key);
    return listed.join();
  },
  testByName: () => "a7" in new Proxy(Object.setPrototypeOf({}, new Proxy({ __proto__: { a7: 1, __proto__: null } }, {})), {}),
  testByKeyNobodyKnows: () =>
    JSON.parse('"a8"') in new Proxy(Object.setPrototypeOf({}, new Proxy({ __proto__: { a8: 1, __proto__: null } }, {})), {}),
  withoutTheOuterProxy: () => count(Object.setPrototypeOf({}, new Proxy({ __proto__: { a9: 1, b9: 2, __proto__: null } }, {}))),
};
for (const [form, ask] of Object.entries(forms)) console.log(form, ask());
