// Every helper that "bun:wrap" exports is compiled with the program that imports it, so the module is never loaded and interpreted.
import * as helpers from "bun:wrap";
import { __callDispose, __using } from "bun:wrap";
import {
  $$typeof, __EARLY_RETURN_SENTINEL, __MEMO_CACHE_SENTINEL, __commonJS, __decorateElement, __decoratorMetadata, __decoratorStart, __esm, __export, __exportCjs,
  __exportDefault, __exportGetters, __exportValue, __jsonParse, __legacyDecorateClassTS, __legacyDecorateParamTS, __legacyMetadataTS, __merge, __name, __privateAdd,
  __privateGet, __privateIn, __privateMethod, __privateSet, __promiseAll, __publicField, __reExport, __runInitializers, __toCommonJS, __toESM,
} from "bun:wrap";
const say = (...values) => console.log(values.map(String).join(" "));
say("namespace", typeof helpers.__toESM, helpers.__toESM === __toESM, "__noSuchHelper" in helpers);
say("symbols", $$typeof, __MEMO_CACHE_SENTINEL, __EARLY_RETURN_SENTINEL, __MEMO_CACHE_SENTINEL === Symbol.for("react.memo_cache_sentinel"));
const required = __commonJS((exports, module) => { module.exports = { a: 1, default: 2 }; });
say("__commonJS", required() === required(), required().a);
say("__toESM", __toESM(required()).a, __toESM(required()).default, __toESM(required(), 1).default.a, __toESM(required()) === __toESM(required()));
const namespace = {}; __export(namespace, { b: () => 3 }); say("__export", namespace.b, Object.keys(namespace).join());
const getters = {}; __exportGetters(getters, { c: () => 4 }); say("__exportGetters", getters.c);
const values = {}; __exportValue(values, { d: 5 }); values.d = 6; say("__exportValue", values.d);
const withDefault = {}; __exportDefault(withDefault, 7); say("__exportDefault", withDefault.default);
let lifted = 8; const cjs = {}; __exportCjs(cjs, { e: () => lifted }, { e: value => { lifted = value; } }); cjs.e = 9; say("__exportCjs", cjs.e, lifted);
const target = { own: 1 }; __reExport(target, { own: 2, f: 10, default: 11 }); say("__reExport", target.own, target.f, "default" in target);
say("__toCommonJS", __toCommonJS(namespace).b, __toCommonJS(namespace).__esModule, __toCommonJS(namespace) === __toCommonJS(namespace));
let started = 0; const start = __esm(() => { started++; }); start(); start(); say("__esm", started);
say("__name", __name(() => {}, "given").name);
say("__merge", JSON.stringify(__merge({ a: 1, b: 2 }, { b: 3 })));
say("__jsonParse", __jsonParse("[1,2]").length, (await __promiseAll([1, Promise.resolve(2)])).join());
const object = {}; __publicField(object, "g", 12); say("__publicField", object.g, Object.keys(object).join());
const secret = new WeakMap(), methods = new WeakSet(); __privateAdd(object, secret, 13); __privateAdd(object, methods);
__privateSet(object, secret, __privateGet(object, secret) + 1);
say("private", __privateGet(object, secret), __privateIn(secret, object), __privateIn(secret, {}), __privateMethod(object, methods, () => 15)());
try { __privateGet({}, secret); } catch (error) { say("private, refused", error.constructor.name); }
const seen = [];
class Legacy { method() { return 16; } }
__legacyDecorateClassTS([(prototype, key, descriptor) => { seen.push(key, typeof descriptor.value); }, __legacyDecorateParamTS(0, (prototype, key, index) => { seen.push(key, index); })], Legacy.prototype, "method", null);
say("legacy", seen.join(), __legacyDecorateClassTS([constructor => { seen.push(constructor.name); }], Legacy) === Legacy, __legacyMetadataTS("design:type", Object));
const array = __decoratorStart(undefined);
class Standard { method() { return 17; } }
__decorateElement(array, 1, "method", [(method, context) => { seen.push(context.kind, context.name); return function () { return method.call(this) + 1; }; }], Standard);
__decoratorMetadata(array, Standard); __runInitializers(array, 1, Standard);
say("standard", new Standard().method(), seen.slice(-2).join(), typeof Standard[Symbol.metadata ?? Symbol.for("Symbol.metadata")]);
const stack = [], disposed = [];
__using(stack, { [Symbol.dispose]() { disposed.push("first"); } }, false); __using(stack, { [Symbol.dispose]() { disposed.push("second"); } }, false); __using(stack, null, false);
__callDispose(stack, undefined, false); say("__using", disposed.join());
try { __using(stack, 1, false); } catch (error) { say("__using, refused", error.message); }
