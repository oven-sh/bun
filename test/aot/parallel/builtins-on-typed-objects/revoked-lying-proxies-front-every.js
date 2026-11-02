// Every question and every change that goes through the traps of a Proxy throws a TypeError on a revoked one, and where a trap breaks an invariant. Each call is the only operation in its try block.
function revoked() { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy; }
function lying() { return new Proxy(Object.preventExtensions({}), { isExtensible() { return true; }, getPrototypeOf() { return Array.prototype; }, ownKeys() { return ["a"]; }, has() { return true; }, getOwnPropertyDescriptor() { return { value: 1, configurable: true }; } }); }
const questions = {
  isExtensible(p) { try { return Object.isExtensible(p); } catch (e) { return e.name; } },
  isFrozen(p) { try { return Object.isFrozen(p); } catch (e) { return e.name; } },
  isSealed(p) { try { return Object.isSealed(p); } catch (e) { return e.name; } },
  reflectIsExtensible(p) { try { return Reflect.isExtensible(p); } catch (e) { return e.name; } },
  getPrototypeOf(p) { try { return Object.getPrototypeOf(p) === Object.prototype; } catch (e) { return e.name; } },
  reflectGetPrototypeOf(p) { try { return Reflect.getPrototypeOf(p) === Object.prototype; } catch (e) { return e.name; } },
  keys(p) { try { return Object.keys(p).length; } catch (e) { return e.name; } },
  ownKeys(p) { try { return Reflect.ownKeys(p).length; } catch (e) { return e.name; } },
  names(p) { try { return Object.getOwnPropertyNames(p).length; } catch (e) { return e.name; } },
  symbols(p) { try { return Object.getOwnPropertySymbols(p).length; } catch (e) { return e.name; } },
  hasOwn(p) { try { return Object.hasOwn(p, "k"); } catch (e) { return e.name; } },
  hasOwnProperty(p) { try { return Object.prototype.hasOwnProperty.call(p, "k"); } catch (e) { return e.name; } },
  has(p) { try { return Reflect.has(p, "k"); } catch (e) { return e.name; } },
  inOperator(p) { try { return "k" in p; } catch (e) { return e.name; } },
  descriptor(p) { try { return Object.getOwnPropertyDescriptor(p, "k") === undefined; } catch (e) { return e.name; } },
  descriptors(p) { try { return Object.keys(Object.getOwnPropertyDescriptors(p)).length; } catch (e) { return e.name; } },
  isEnumerable(p) { try { return Object.prototype.propertyIsEnumerable.call(p, "k"); } catch (e) { return e.name; } },
  isPrototypeOf(p) { try { return Object.prototype.isPrototypeOf.call(Object.prototype, p); } catch (e) { return e.name; } },
  isArray(p) { try { return Array.isArray(p); } catch (e) { return e.name; } },
  toStringTag(p) { try { return Object.prototype.toString.call(p); } catch (e) { return e.name; } },
  instanceOf(p) { try { return p instanceof Object; } catch (e) { return e.name; } },
  preventExtensions(p) { try { return Object.preventExtensions(p) === p; } catch (e) { return e.name; } },
  freeze(p) { try { return Object.freeze(p) === p; } catch (e) { return e.name; } },
  seal(p) { try { return Object.seal(p) === p; } catch (e) { return e.name; } },
  entries(p) { try { return Object.entries(p).length; } catch (e) { return e.name; } },
  values(p) { try { return Object.values(p).length; } catch (e) { return e.name; } },
  assignFrom(p) { try { return Object.keys(Object.assign({}, p)).length; } catch (e) { return e.name; } },
  spread(p) { try { return Object.keys({ ...p }).length; } catch (e) { return e.name; } },
  stringify(p) { try { return JSON.stringify(p); } catch (e) { return e.name; } },
  get(p) { try { return Reflect.get(p, "k"); } catch (e) { return e.name; } },
  set(p) { try { return Reflect.set(p, "k", 1); } catch (e) { return e.name; } },
  deleteProperty(p) { try { return Reflect.deleteProperty(p, "k"); } catch (e) { return e.name; } },
  setPrototypeOf(p) { try { return Reflect.setPrototypeOf(p, null); } catch (e) { return e.name; } },
  isError(p) { try { return Error.isError(p); } catch (e) { return e.name; } },
  isView(p) { try { return ArrayBuffer.isView(p); } catch (e) { return e.name; } },
};
for (const name in questions) {
  let onRevoked, onLying, onPlain;
  for (let i = 0; i < 300; i++) { onRevoked = questions[name](revoked()); onLying = questions[name](lying()); onPlain = questions[name]({ k: 1 }); }
  console.log(name, onRevoked, onLying, onPlain);
}
