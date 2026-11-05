// node:_http_outgoing exports the symbol under which a message keeps the map of its headers. A program takes it in seven ways and does every kind of look and change under it,
// each on a response of its own that it has made by hand and that has no header yet. Behind each it sets a header and asks for the headers.
const http = require("node:http"),
  net = require("node:net"),
  events = require("node:events");
const { kOutHeaders } = require("node:_http_outgoing");
const whole = require("node:_http_outgoing");
const kept = require("_http_outgoing").kOutHeaders;
const { kOutHeaders: fromProcess } = process.getBuiltinModule("node:_http_outgoing");
const holder = { key: require("node:_http_outgoing").kOutHeaders };
function answered() {
  return require("node:_http_outgoing").kOutHeaders;
}
const lines = [];
const show = value =>
  typeof value !== "object" || value === null
    ? String(value)
    : Object.getPrototypeOf(value) === null || Array.isArray(value)
      ? JSON.stringify(value)
      : "a " + value.constructor.name;
const limited = target => (events.setMaxListeners(3, target), target);
const steps = {
  "/a-pattern/read": o => show(o[kOutHeaders]),
  "/a-pattern/read-in-a-chain": o => show(o?.[kOutHeaders]),
  "/a-pattern/a-pattern": o => (({ [kOutHeaders]: found }) => show(found))(o),
  "/a-pattern/a-pattern-with-the-rest": o =>
    (({ [kOutHeaders]: found, ...rest }) => show(found) + " " + (kOutHeaders in rest))(o),
  "/a-pattern/in": o =>
    (kOutHeaders in o) +
    " " +
    Object.hasOwn(o, kOutHeaders) +
    " " +
    Object.prototype.hasOwnProperty.call(o, kOutHeaders) +
    " " +
    Object.prototype.propertyIsEnumerable.call(o, kOutHeaders),
  "/a-pattern/a-descriptor": o => show(Object.getOwnPropertyDescriptor(o, kOutHeaders)?.value),
  "/a-pattern/Reflect.get": o => show(Reflect.get(o, kOutHeaders)) + " " + Reflect.has(o, kOutHeaders),
  "/a-pattern/a-spread": o => show({ ...o }[kOutHeaders]),
  "/a-pattern/an-heir": o => show(Object.create(o)[kOutHeaders]),
  "/a-pattern/store-a-number": o => ((o[kOutHeaders] = 7), show(o[kOutHeaders])),
  "/a-pattern/store-a-map": o => (
    (o[kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[kOutHeaders])
  ),
  "/a-pattern/store-null": o => ((o[kOutHeaders] = null), show(o[kOutHeaders])),
  "/a-pattern/store-undefined": o => ((o[kOutHeaders] = undefined), show(o[kOutHeaders]) + " " + (kOutHeaders in o)),
  "/a-pattern/store-a-map-if-there-is-none": o => (
    (o[kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[kOutHeaders])
  ),
  "/a-pattern/Reflect.set": o =>
    Reflect.set(o, kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(o[kOutHeaders]),
  "/a-pattern/define": o => (
    Object.defineProperty(o, kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(o[kOutHeaders])
  ),
  "/a-pattern/define-hidden-and-fixed": o => (
    Object.defineProperty(o, kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: false,
      enumerable: false,
      configurable: true,
    }),
    show(o[kOutHeaders]) + " " + Object.prototype.propertyIsEnumerable.call(o, kOutHeaders)
  ),
  "/a-pattern/define-accessors": o => (
    Object.defineProperty(o, kOutHeaders, {
      get() {
        lines.push("  the getter runs");
        return { __proto__: null, "x-two": ["X-Two", "2"] };
      },
      set(stored) {
        lines.push("  the setter gets " + show(stored));
      },
      configurable: true,
    }),
    show(o[kOutHeaders])
  ),
  "/a-pattern/Reflect.defineProperty": o =>
    Reflect.defineProperty(o, kOutHeaders, { value: 7 }) + " " + show(o[kOutHeaders]),
  "/a-pattern/delete": o => delete o[kOutHeaders] + " " + show(o[kOutHeaders]) + " " + (kOutHeaders in o),
  "/a-pattern/Reflect.deleteProperty": o =>
    Reflect.deleteProperty(o, kOutHeaders) + " " + show(o[kOutHeaders]) + " " + (kOutHeaders in o),
  "/a-pattern/Object.assign-onto-it": o => (
    Object.assign(o, { [kOutHeaders]: { __proto__: null, "x-two": ["X-Two", "2"] } }),
    show(o[kOutHeaders])
  ),
  "/a-pattern/freeze,-then-read": o => (Object.freeze(o), show(o[kOutHeaders])),
  "/a-pattern/store-on-an-heir": o =>
    (heir => (
      (heir[kOutHeaders] = 7),
      show(heir[kOutHeaders]) + " " + Object.hasOwn(heir, kOutHeaders) + " " + show(o[kOutHeaders])
    ))(Object.create(o)),
  "/a-member/read": o => show(o[whole.kOutHeaders]),
  "/a-member/read-in-a-chain": o => show(o?.[whole.kOutHeaders]),
  "/a-member/a-pattern": o => (({ [whole.kOutHeaders]: found }) => show(found))(o),
  "/a-member/a-pattern-with-the-rest": o =>
    (({ [whole.kOutHeaders]: found, ...rest }) => show(found) + " " + (whole.kOutHeaders in rest))(o),
  "/a-member/in": o =>
    (whole.kOutHeaders in o) +
    " " +
    Object.hasOwn(o, whole.kOutHeaders) +
    " " +
    Object.prototype.hasOwnProperty.call(o, whole.kOutHeaders) +
    " " +
    Object.prototype.propertyIsEnumerable.call(o, whole.kOutHeaders),
  "/a-member/a-descriptor": o => show(Object.getOwnPropertyDescriptor(o, whole.kOutHeaders)?.value),
  "/a-member/Reflect.get": o => show(Reflect.get(o, whole.kOutHeaders)) + " " + Reflect.has(o, whole.kOutHeaders),
  "/a-member/a-spread": o => show({ ...o }[whole.kOutHeaders]),
  "/a-member/an-heir": o => show(Object.create(o)[whole.kOutHeaders]),
  "/a-member/store-a-number": o => ((o[whole.kOutHeaders] = 7), show(o[whole.kOutHeaders])),
  "/a-member/store-a-map": o => (
    (o[whole.kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[whole.kOutHeaders])
  ),
  "/a-member/store-null": o => ((o[whole.kOutHeaders] = null), show(o[whole.kOutHeaders])),
  "/a-member/store-undefined": o => (
    (o[whole.kOutHeaders] = undefined),
    show(o[whole.kOutHeaders]) + " " + (whole.kOutHeaders in o)
  ),
  "/a-member/store-a-map-if-there-is-none": o => (
    (o[whole.kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[whole.kOutHeaders])
  ),
  "/a-member/Reflect.set": o =>
    Reflect.set(o, whole.kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(o[whole.kOutHeaders]),
  "/a-member/define": o => (
    Object.defineProperty(o, whole.kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(o[whole.kOutHeaders])
  ),
  "/a-member/define-hidden-and-fixed": o => (
    Object.defineProperty(o, whole.kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: false,
      enumerable: false,
      configurable: true,
    }),
    show(o[whole.kOutHeaders]) + " " + Object.prototype.propertyIsEnumerable.call(o, whole.kOutHeaders)
  ),
  "/a-member/define-accessors": o => (
    Object.defineProperty(o, whole.kOutHeaders, {
      get() {
        lines.push("  the getter runs");
        return { __proto__: null, "x-two": ["X-Two", "2"] };
      },
      set(stored) {
        lines.push("  the setter gets " + show(stored));
      },
      configurable: true,
    }),
    show(o[whole.kOutHeaders])
  ),
  "/a-member/Reflect.defineProperty": o =>
    Reflect.defineProperty(o, whole.kOutHeaders, { value: 7 }) + " " + show(o[whole.kOutHeaders]),
  "/a-member/delete": o =>
    delete o[whole.kOutHeaders] + " " + show(o[whole.kOutHeaders]) + " " + (whole.kOutHeaders in o),
  "/a-member/Reflect.deleteProperty": o =>
    Reflect.deleteProperty(o, whole.kOutHeaders) + " " + show(o[whole.kOutHeaders]) + " " + (whole.kOutHeaders in o),
  "/a-member/Object.assign-onto-it": o => (
    Object.assign(o, { [whole.kOutHeaders]: { __proto__: null, "x-two": ["X-Two", "2"] } }),
    show(o[whole.kOutHeaders])
  ),
  "/a-member/freeze,-then-read": o => (Object.freeze(o), show(o[whole.kOutHeaders])),
  "/a-member/store-on-an-heir": o =>
    (heir => (
      (heir[whole.kOutHeaders] = 7),
      show(heir[whole.kOutHeaders]) + " " + Object.hasOwn(heir, whole.kOutHeaders) + " " + show(o[whole.kOutHeaders])
    ))(Object.create(o)),
  "/a-variable/read": o => show(o[kept]),
  "/a-variable/read-in-a-chain": o => show(o?.[kept]),
  "/a-variable/a-pattern": o => (({ [kept]: found }) => show(found))(o),
  "/a-variable/a-pattern-with-the-rest": o => (({ [kept]: found, ...rest }) => show(found) + " " + (kept in rest))(o),
  "/a-variable/in": o =>
    (kept in o) +
    " " +
    Object.hasOwn(o, kept) +
    " " +
    Object.prototype.hasOwnProperty.call(o, kept) +
    " " +
    Object.prototype.propertyIsEnumerable.call(o, kept),
  "/a-variable/a-descriptor": o => show(Object.getOwnPropertyDescriptor(o, kept)?.value),
  "/a-variable/Reflect.get": o => show(Reflect.get(o, kept)) + " " + Reflect.has(o, kept),
  "/a-variable/a-spread": o => show({ ...o }[kept]),
  "/a-variable/an-heir": o => show(Object.create(o)[kept]),
  "/a-variable/store-a-number": o => ((o[kept] = 7), show(o[kept])),
  "/a-variable/store-a-map": o => ((o[kept] = { __proto__: null, "x-two": ["X-Two", "2"] }), show(o[kept])),
  "/a-variable/store-null": o => ((o[kept] = null), show(o[kept])),
  "/a-variable/store-undefined": o => ((o[kept] = undefined), show(o[kept]) + " " + (kept in o)),
  "/a-variable/store-a-map-if-there-is-none": o => (
    (o[kept] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[kept])
  ),
  "/a-variable/Reflect.set": o =>
    Reflect.set(o, kept, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(o[kept]),
  "/a-variable/define": o => (
    Object.defineProperty(o, kept, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(o[kept])
  ),
  "/a-variable/define-hidden-and-fixed": o => (
    Object.defineProperty(o, kept, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: false,
      enumerable: false,
      configurable: true,
    }),
    show(o[kept]) + " " + Object.prototype.propertyIsEnumerable.call(o, kept)
  ),
  "/a-variable/define-accessors": o => (
    Object.defineProperty(o, kept, {
      get() {
        lines.push("  the getter runs");
        return { __proto__: null, "x-two": ["X-Two", "2"] };
      },
      set(stored) {
        lines.push("  the setter gets " + show(stored));
      },
      configurable: true,
    }),
    show(o[kept])
  ),
  "/a-variable/Reflect.defineProperty": o => Reflect.defineProperty(o, kept, { value: 7 }) + " " + show(o[kept]),
  "/a-variable/delete": o => delete o[kept] + " " + show(o[kept]) + " " + (kept in o),
  "/a-variable/Reflect.deleteProperty": o => Reflect.deleteProperty(o, kept) + " " + show(o[kept]) + " " + (kept in o),
  "/a-variable/Object.assign-onto-it": o => (
    Object.assign(o, { [kept]: { __proto__: null, "x-two": ["X-Two", "2"] } }),
    show(o[kept])
  ),
  "/a-variable/freeze,-then-read": o => (Object.freeze(o), show(o[kept])),
  "/a-variable/store-on-an-heir": o =>
    (heir => ((heir[kept] = 7), show(heir[kept]) + " " + Object.hasOwn(heir, kept) + " " + show(o[kept])))(
      Object.create(o),
    ),
  "/process/read": o => show(o[fromProcess]),
  "/process/read-in-a-chain": o => show(o?.[fromProcess]),
  "/process/a-pattern": o => (({ [fromProcess]: found }) => show(found))(o),
  "/process/a-pattern-with-the-rest": o =>
    (({ [fromProcess]: found, ...rest }) => show(found) + " " + (fromProcess in rest))(o),
  "/process/in": o =>
    (fromProcess in o) +
    " " +
    Object.hasOwn(o, fromProcess) +
    " " +
    Object.prototype.hasOwnProperty.call(o, fromProcess) +
    " " +
    Object.prototype.propertyIsEnumerable.call(o, fromProcess),
  "/process/a-descriptor": o => show(Object.getOwnPropertyDescriptor(o, fromProcess)?.value),
  "/process/Reflect.get": o => show(Reflect.get(o, fromProcess)) + " " + Reflect.has(o, fromProcess),
  "/process/a-spread": o => show({ ...o }[fromProcess]),
  "/process/an-heir": o => show(Object.create(o)[fromProcess]),
  "/process/store-a-number": o => ((o[fromProcess] = 7), show(o[fromProcess])),
  "/process/store-a-map": o => ((o[fromProcess] = { __proto__: null, "x-two": ["X-Two", "2"] }), show(o[fromProcess])),
  "/process/store-null": o => ((o[fromProcess] = null), show(o[fromProcess])),
  "/process/store-undefined": o => ((o[fromProcess] = undefined), show(o[fromProcess]) + " " + (fromProcess in o)),
  "/process/store-a-map-if-there-is-none": o => (
    (o[fromProcess] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[fromProcess])
  ),
  "/process/Reflect.set": o =>
    Reflect.set(o, fromProcess, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(o[fromProcess]),
  "/process/define": o => (
    Object.defineProperty(o, fromProcess, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(o[fromProcess])
  ),
  "/process/define-hidden-and-fixed": o => (
    Object.defineProperty(o, fromProcess, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: false,
      enumerable: false,
      configurable: true,
    }),
    show(o[fromProcess]) + " " + Object.prototype.propertyIsEnumerable.call(o, fromProcess)
  ),
  "/process/define-accessors": o => (
    Object.defineProperty(o, fromProcess, {
      get() {
        lines.push("  the getter runs");
        return { __proto__: null, "x-two": ["X-Two", "2"] };
      },
      set(stored) {
        lines.push("  the setter gets " + show(stored));
      },
      configurable: true,
    }),
    show(o[fromProcess])
  ),
  "/process/Reflect.defineProperty": o =>
    Reflect.defineProperty(o, fromProcess, { value: 7 }) + " " + show(o[fromProcess]),
  "/process/delete": o => delete o[fromProcess] + " " + show(o[fromProcess]) + " " + (fromProcess in o),
  "/process/Reflect.deleteProperty": o =>
    Reflect.deleteProperty(o, fromProcess) + " " + show(o[fromProcess]) + " " + (fromProcess in o),
  "/process/Object.assign-onto-it": o => (
    Object.assign(o, { [fromProcess]: { __proto__: null, "x-two": ["X-Two", "2"] } }),
    show(o[fromProcess])
  ),
  "/process/freeze,-then-read": o => (Object.freeze(o), show(o[fromProcess])),
  "/process/store-on-an-heir": o =>
    (heir => (
      (heir[fromProcess] = 7),
      show(heir[fromProcess]) + " " + Object.hasOwn(heir, fromProcess) + " " + show(o[fromProcess])
    ))(Object.create(o)),
  "/a-holder/read": o => show(o[holder.key]),
  "/a-holder/read-in-a-chain": o => show(o?.[holder.key]),
  "/a-holder/a-pattern": o => (({ [holder.key]: found }) => show(found))(o),
  "/a-holder/a-pattern-with-the-rest": o =>
    (({ [holder.key]: found, ...rest }) => show(found) + " " + (holder.key in rest))(o),
  "/a-holder/in": o =>
    (holder.key in o) +
    " " +
    Object.hasOwn(o, holder.key) +
    " " +
    Object.prototype.hasOwnProperty.call(o, holder.key) +
    " " +
    Object.prototype.propertyIsEnumerable.call(o, holder.key),
  "/a-holder/a-descriptor": o => show(Object.getOwnPropertyDescriptor(o, holder.key)?.value),
  "/a-holder/Reflect.get": o => show(Reflect.get(o, holder.key)) + " " + Reflect.has(o, holder.key),
  "/a-holder/a-spread": o => show({ ...o }[holder.key]),
  "/a-holder/an-heir": o => show(Object.create(o)[holder.key]),
  "/a-holder/store-a-number": o => ((o[holder.key] = 7), show(o[holder.key])),
  "/a-holder/store-a-map": o => ((o[holder.key] = { __proto__: null, "x-two": ["X-Two", "2"] }), show(o[holder.key])),
  "/a-holder/store-null": o => ((o[holder.key] = null), show(o[holder.key])),
  "/a-holder/store-undefined": o => ((o[holder.key] = undefined), show(o[holder.key]) + " " + (holder.key in o)),
  "/a-holder/store-a-map-if-there-is-none": o => (
    (o[holder.key] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[holder.key])
  ),
  "/a-holder/Reflect.set": o =>
    Reflect.set(o, holder.key, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(o[holder.key]),
  "/a-holder/define": o => (
    Object.defineProperty(o, holder.key, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(o[holder.key])
  ),
  "/a-holder/define-hidden-and-fixed": o => (
    Object.defineProperty(o, holder.key, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: false,
      enumerable: false,
      configurable: true,
    }),
    show(o[holder.key]) + " " + Object.prototype.propertyIsEnumerable.call(o, holder.key)
  ),
  "/a-holder/define-accessors": o => (
    Object.defineProperty(o, holder.key, {
      get() {
        lines.push("  the getter runs");
        return { __proto__: null, "x-two": ["X-Two", "2"] };
      },
      set(stored) {
        lines.push("  the setter gets " + show(stored));
      },
      configurable: true,
    }),
    show(o[holder.key])
  ),
  "/a-holder/Reflect.defineProperty": o =>
    Reflect.defineProperty(o, holder.key, { value: 7 }) + " " + show(o[holder.key]),
  "/a-holder/delete": o => delete o[holder.key] + " " + show(o[holder.key]) + " " + (holder.key in o),
  "/a-holder/Reflect.deleteProperty": o =>
    Reflect.deleteProperty(o, holder.key) + " " + show(o[holder.key]) + " " + (holder.key in o),
  "/a-holder/Object.assign-onto-it": o => (
    Object.assign(o, { [holder.key]: { __proto__: null, "x-two": ["X-Two", "2"] } }),
    show(o[holder.key])
  ),
  "/a-holder/freeze,-then-read": o => (Object.freeze(o), show(o[holder.key])),
  "/a-holder/store-on-an-heir": o =>
    (heir => (
      (heir[holder.key] = 7),
      show(heir[holder.key]) + " " + Object.hasOwn(heir, holder.key) + " " + show(o[holder.key])
    ))(Object.create(o)),
  "/a-function/read": o => show(o[answered()]),
  "/a-function/read-in-a-chain": o => show(o?.[answered()]),
  "/a-function/a-pattern": o => (({ [answered()]: found }) => show(found))(o),
  "/a-function/a-pattern-with-the-rest": o =>
    (({ [answered()]: found, ...rest }) => show(found) + " " + (answered() in rest))(o),
  "/a-function/in": o =>
    (answered() in o) +
    " " +
    Object.hasOwn(o, answered()) +
    " " +
    Object.prototype.hasOwnProperty.call(o, answered()) +
    " " +
    Object.prototype.propertyIsEnumerable.call(o, answered()),
  "/a-function/a-descriptor": o => show(Object.getOwnPropertyDescriptor(o, answered())?.value),
  "/a-function/Reflect.get": o => show(Reflect.get(o, answered())) + " " + Reflect.has(o, answered()),
  "/a-function/a-spread": o => show({ ...o }[answered()]),
  "/a-function/an-heir": o => show(Object.create(o)[answered()]),
  "/a-function/store-a-number": o => ((o[answered()] = 7), show(o[answered()])),
  "/a-function/store-a-map": o => ((o[answered()] = { __proto__: null, "x-two": ["X-Two", "2"] }), show(o[answered()])),
  "/a-function/store-null": o => ((o[answered()] = null), show(o[answered()])),
  "/a-function/store-undefined": o => ((o[answered()] = undefined), show(o[answered()]) + " " + (answered() in o)),
  "/a-function/store-a-map-if-there-is-none": o => (
    (o[answered()] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[answered()])
  ),
  "/a-function/Reflect.set": o =>
    Reflect.set(o, answered(), { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(o[answered()]),
  "/a-function/define": o => (
    Object.defineProperty(o, answered(), {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(o[answered()])
  ),
  "/a-function/define-hidden-and-fixed": o => (
    Object.defineProperty(o, answered(), {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: false,
      enumerable: false,
      configurable: true,
    }),
    show(o[answered()]) + " " + Object.prototype.propertyIsEnumerable.call(o, answered())
  ),
  "/a-function/define-accessors": o => (
    Object.defineProperty(o, answered(), {
      get() {
        lines.push("  the getter runs");
        return { __proto__: null, "x-two": ["X-Two", "2"] };
      },
      set(stored) {
        lines.push("  the setter gets " + show(stored));
      },
      configurable: true,
    }),
    show(o[answered()])
  ),
  "/a-function/Reflect.defineProperty": o =>
    Reflect.defineProperty(o, answered(), { value: 7 }) + " " + show(o[answered()]),
  "/a-function/delete": o => delete o[answered()] + " " + show(o[answered()]) + " " + (answered() in o),
  "/a-function/Reflect.deleteProperty": o =>
    Reflect.deleteProperty(o, answered()) + " " + show(o[answered()]) + " " + (answered() in o),
  "/a-function/Object.assign-onto-it": o => (
    Object.assign(o, { [answered()]: { __proto__: null, "x-two": ["X-Two", "2"] } }),
    show(o[answered()])
  ),
  "/a-function/freeze,-then-read": o => (Object.freeze(o), show(o[answered()])),
  "/a-function/store-on-an-heir": o =>
    (heir => (
      (heir[answered()] = 7),
      show(heir[answered()]) + " " + Object.hasOwn(heir, answered()) + " " + show(o[answered()])
    ))(Object.create(o)),
  "/at-the-use/read": o => show(o[require("node:_http_outgoing").kOutHeaders]),
  "/at-the-use/read-in-a-chain": o => show(o?.[require("node:_http_outgoing").kOutHeaders]),
  "/at-the-use/a-pattern": o => (({ [require("node:_http_outgoing").kOutHeaders]: found }) => show(found))(o),
  "/at-the-use/a-pattern-with-the-rest": o =>
    (({ [require("node:_http_outgoing").kOutHeaders]: found, ...rest }) =>
      show(found) + " " + (require("node:_http_outgoing").kOutHeaders in rest))(o),
  "/at-the-use/in": o =>
    (require("node:_http_outgoing").kOutHeaders in o) +
    " " +
    Object.hasOwn(o, require("node:_http_outgoing").kOutHeaders) +
    " " +
    Object.prototype.hasOwnProperty.call(o, require("node:_http_outgoing").kOutHeaders) +
    " " +
    Object.prototype.propertyIsEnumerable.call(o, require("node:_http_outgoing").kOutHeaders),
  "/at-the-use/a-descriptor": o =>
    show(Object.getOwnPropertyDescriptor(o, require("node:_http_outgoing").kOutHeaders)?.value),
  "/at-the-use/Reflect.get": o =>
    show(Reflect.get(o, require("node:_http_outgoing").kOutHeaders)) +
    " " +
    Reflect.has(o, require("node:_http_outgoing").kOutHeaders),
  "/at-the-use/a-spread": o => show({ ...o }[require("node:_http_outgoing").kOutHeaders]),
  "/at-the-use/an-heir": o => show(Object.create(o)[require("node:_http_outgoing").kOutHeaders]),
  "/at-the-use/store-a-number": o => (
    (o[require("node:_http_outgoing").kOutHeaders] = 7),
    show(o[require("node:_http_outgoing").kOutHeaders])
  ),
  "/at-the-use/store-a-map": o => (
    (o[require("node:_http_outgoing").kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[require("node:_http_outgoing").kOutHeaders])
  ),
  "/at-the-use/store-null": o => (
    (o[require("node:_http_outgoing").kOutHeaders] = null),
    show(o[require("node:_http_outgoing").kOutHeaders])
  ),
  "/at-the-use/store-undefined": o => (
    (o[require("node:_http_outgoing").kOutHeaders] = undefined),
    show(o[require("node:_http_outgoing").kOutHeaders]) + " " + (require("node:_http_outgoing").kOutHeaders in o)
  ),
  "/at-the-use/store-a-map-if-there-is-none": o => (
    (o[require("node:_http_outgoing").kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(o[require("node:_http_outgoing").kOutHeaders])
  ),
  "/at-the-use/Reflect.set": o =>
    Reflect.set(o, require("node:_http_outgoing").kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) +
    " " +
    show(o[require("node:_http_outgoing").kOutHeaders]),
  "/at-the-use/define": o => (
    Object.defineProperty(o, require("node:_http_outgoing").kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(o[require("node:_http_outgoing").kOutHeaders])
  ),
  "/at-the-use/define-hidden-and-fixed": o => (
    Object.defineProperty(o, require("node:_http_outgoing").kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: false,
      enumerable: false,
      configurable: true,
    }),
    show(o[require("node:_http_outgoing").kOutHeaders]) +
      " " +
      Object.prototype.propertyIsEnumerable.call(o, require("node:_http_outgoing").kOutHeaders)
  ),
  "/at-the-use/define-accessors": o => (
    Object.defineProperty(o, require("node:_http_outgoing").kOutHeaders, {
      get() {
        lines.push("  the getter runs");
        return { __proto__: null, "x-two": ["X-Two", "2"] };
      },
      set(stored) {
        lines.push("  the setter gets " + show(stored));
      },
      configurable: true,
    }),
    show(o[require("node:_http_outgoing").kOutHeaders])
  ),
  "/at-the-use/Reflect.defineProperty": o =>
    Reflect.defineProperty(o, require("node:_http_outgoing").kOutHeaders, { value: 7 }) +
    " " +
    show(o[require("node:_http_outgoing").kOutHeaders]),
  "/at-the-use/delete": o =>
    delete o[require("node:_http_outgoing").kOutHeaders] +
    " " +
    show(o[require("node:_http_outgoing").kOutHeaders]) +
    " " +
    (require("node:_http_outgoing").kOutHeaders in o),
  "/at-the-use/Reflect.deleteProperty": o =>
    Reflect.deleteProperty(o, require("node:_http_outgoing").kOutHeaders) +
    " " +
    show(o[require("node:_http_outgoing").kOutHeaders]) +
    " " +
    (require("node:_http_outgoing").kOutHeaders in o),
  "/at-the-use/Object.assign-onto-it": o => (
    Object.assign(o, { [require("node:_http_outgoing").kOutHeaders]: { __proto__: null, "x-two": ["X-Two", "2"] } }),
    show(o[require("node:_http_outgoing").kOutHeaders])
  ),
  "/at-the-use/freeze,-then-read": o => (Object.freeze(o), show(o[require("node:_http_outgoing").kOutHeaders])),
  "/at-the-use/store-on-an-heir": o =>
    (heir => (
      (heir[require("node:_http_outgoing").kOutHeaders] = 7),
      show(heir[require("node:_http_outgoing").kOutHeaders]) +
        " " +
        Object.hasOwn(heir, require("node:_http_outgoing").kOutHeaders) +
        " " +
        show(o[require("node:_http_outgoing").kOutHeaders])
    ))(Object.create(o)),
};
function take(name, o) {
  let seen;
  try {
    seen = steps[name](o);
  } catch (error) {
    seen = "throws " + error.name;
  }
  lines.push(name + ": " + seen);
  if (typeof o.getHeaders !== "function") return;
  try {
    o.setHeader("X-Three", "3");
    lines.push("  " + JSON.stringify(o.getHeaders()));
  } catch (error) {
    lines.push("  throws " + error.name);
  }
}
process.on("uncaughtException", error => lines.push("  nobody caught " + error.name));
for (const name of Object.keys(steps)) {
  const o = new http.ServerResponse(new http.IncomingMessage(new net.Socket()));
  take(name, o);
  if (typeof o.close === "function") o.close();
}
console.log(lines.join("\n"));
