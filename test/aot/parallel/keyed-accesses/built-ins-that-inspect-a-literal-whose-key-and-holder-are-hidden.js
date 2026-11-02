// Nothing here reads a field by its name. A built-in that inspects the holder under a key nobody knows must keep every field of the literal.
const zero = process.argv.length > 100 ? 1 : 0;
const keys = JSON.parse('["a","zz"]');
const hasOwnProperty = Object.prototype.hasOwnProperty;
const isEnumerable = Object.prototype.propertyIsEnumerable;
const hide = list => list[zero];
const forms = {
  call: k => hasOwnProperty.call(hide([{ a: 1 }]), k),
  apply: k => hasOwnProperty.apply(hide([{ a: 1 }]), [k]),
  reflectApply: k => Reflect.apply(hasOwnProperty, hide([{ a: 1 }]), [k]),
  bind: k => hasOwnProperty.bind(hide([{ a: 1 }]))(k),
  callOfCall: k => Function.prototype.call.call(hasOwnProperty, hide([{ a: 1 }]), k),
  listOfBuiltins: k => [hasOwnProperty][zero].call(hide([{ a: 1 }]), k),
  methodByKey: k => hide([{ a: 1 }])[JSON.parse('"hasOwnProperty"')](k),
  filter: k => [k].filter(hasOwnProperty, hide([{ a: 1 }])).length,
  some: k => [k].some(hasOwnProperty, hide([{ a: 1 }])),
  hasOwn: k => Object.hasOwn(hide([{ a: 1 }]), k),
  hasOwnCall: k => Object.hasOwn.call(null, hide([{ a: 1 }]), k),
  hasOwnReflect: k => Reflect.apply(Object.hasOwn, null, [hide([{ a: 1 }]), k]),
  in: k => k in hide([{ a: 1 }]),
  reflectHas: k => Reflect.has(hide([{ a: 1 }]), k),
  inChild: k => k in Object.create(hide([{ a: 1 }])),
  inProxy: k => k in new Proxy(hide([{ a: 1 }]), {}),
  hasOwnProxy: k => Object.hasOwn(new Proxy(hide([{ a: 1 }]), {}), k),
  keys: k => Object.keys(hide([{ a: 1 }])).includes(k),
  names: k => Object.getOwnPropertyNames(hide([{ a: 1 }])).includes(k),
  ownKeys: k => Reflect.ownKeys(hide([{ a: 1 }])).includes(k),
  entries: k => Object.entries(hide([{ a: 1 }])).some(entry => entry[0] === k),
  forIn: k => {
    for (const key in hide([{ a: 1 }])) if (key === k) return true;
    return false;
  },
  spread: k => Object.hasOwn({ ...hide([{ a: 1 }]) }, k),
  assign: k => Object.hasOwn(Object.assign({}, hide([{ a: 1 }])), k),
  descriptor: k => !!Object.getOwnPropertyDescriptor(hide([{ a: 1 }]), k),
  reflectDescriptor: k => !!Reflect.getOwnPropertyDescriptor(hide([{ a: 1 }]), k),
  isEnumerable: k => isEnumerable.call(hide([{ a: 1 }]), k),
  frozen: k => Object.isFrozen(Object.preventExtensions(hide([{ a: 1 }]))),
  json: k => JSON.stringify(hide([{ a: 1 }])),
  inspect: k => Bun.inspect(hide([{ a: 1 }])),
  structuredClone: k => Object.keys(structuredClone(hide([{ a: 1 }]))).length,
  deepEquals: k => Bun.deepEquals(hide([{ a: 1 }]), {}),
  searchParams: k => new URLSearchParams(hide([{ a: 1 }])).toString(),
  objectKey: k => Object.hasOwn(hide([{ a: 1 }]), { toString: () => k }),
  listKey: k => hasOwnProperty.call(hide([{ a: 1 }]), [k]),
  methodOnlyCalled: k => {
    const holder = hide([{ a() { return 7; } }]);
    holder.a();
    return Object.hasOwn(holder, k);
  },
  twoLiterals: k => [hide([{ a: 1 }]), hide([{ b: 2 }])].map(holder => hasOwnProperty.call(holder, k)).join(),
  bool: k => Object.hasOwn(hide([{ true: 1 }]), keys[zero] === k),
  undefinedKey: k => Object.hasOwn(hide([{ undefined: 1 }])),
};
for (const [form, ask] of Object.entries(forms)) console.log(form, ...keys.map(ask));
