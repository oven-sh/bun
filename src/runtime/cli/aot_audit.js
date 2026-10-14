(function (describe, write, isProxy, workingDirectory, remember, tag, tagOf) {
  "use strict";
  const UNDEFINED = 1, NULL = 2, FALSE = 4, TRUE = 8, NUMBER = 16, STRING = 32, SYMBOL = 64, BIGINT = 128;
  const global = globalThis;
  const { isArray } = Array;
  const { is, getPrototypeOf, getOwnPropertyDescriptor, isExtensible } = Object;
  const { isInteger } = Number;
  const { parse, stringify } = JSON;
  const isJSON = describe("format") === "json";
  const { apply, ownKeys } = Reflect;
  const ObjectPrototype = Object.prototype;
  const objectToString = ObjectPrototype.toString;
  const functionToString = Function.prototype.toString;
  const stringSlice = String.prototype.slice;
  const stringStartsWith = String.prototype.startsWith;
  const stringSplit = String.prototype.split;
  const stringIndexOf = String.prototype.indexOf;
  const stringLastIndexOf = String.prototype.lastIndexOf;
  const stringIncludes = String.prototype.includes;
  const arrayIterator = Array.prototype[Symbol.iterator];
  const iterator = Symbol.iterator;
  const hasInstance = Function.prototype[Symbol.hasInstance];
  const ErrorConstructor = Error;
  const prepareStackTraceAtFirst = Error.prepareStackTrace;
  const toString = String, toNumber = Number, toBoolean = Boolean, toBigInt = BigInt;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapClear = Map.prototype.clear;
  const { hasOwn } = Object;
  const shapes = new Map();
  const receivers = [];
  const { keys } = Object;
  let depth = 0, generation;
  const counts = new Map();
  const converted = new Map();
  const resultsOfCasts = new Map();
  let numberOfResultsOfCasts = 0;
  const groups = [];
  let lastValue, lastType = "", lastPlace = "", hasLast = false, hasSaidThatSomeWait = false;
  const ENTERED = 0x40000000, keysOfEntered = [], numbersOfEntered = new Map();
  let hasLookedAtMembers = false, numberLookedAt = 0;

  function cast(type, value) {
    const kind = typeof value;
    const hasNumber = (type.p & NUMBER) !== 0 || type.i !== undefined, hasString = (type.p & STRING) !== 0, hasBoolean = (type.p & (TRUE | FALSE)) !== 0;
    if ((kind === "object" && value !== null) || kind === "function" || !(hasString ? kind !== "symbol" : hasNumber ? kind !== "symbol" && kind !== "bigint" : hasBoolean)) return;
    const result = hasString ? toString(value) : hasNumber ? toNumber(value) : toBoolean(value);
    if (fits(type, result)) return result;
  }

  function whatACastMadeOf(type, value) {
    if (numberOfResultsOfCasts > 4096) return value === undefined || value === null ? undefined : cast(type, value);
    const results = apply(mapGet, resultsOfCasts, [value]);
    if (results !== undefined) for (let i = 0; i < results.length; i++) if (fits(type, results[i])) return results[i];
  }

  function fits(type, value, under) {
    switch (typeof value) {
      case "undefined": return (type.p & UNDEFINED) !== 0;
      case "boolean": return (type.p & (value ? TRUE : FALSE)) !== 0;
      case "number": return (type.p & NUMBER) !== 0 || (type.i !== undefined && isInteger(value) && !is(value, -0) && value >= type.i[0] && value <= type.i[1]);
      case "string": return (type.p & STRING) !== 0;
      case "symbol": return (type.p & SYMBOL) !== 0;
      case "bigint": return (type.p & BIGINT) !== 0;
      case "function":
        if (type.o || type.fn) return true;
        for (let i = 0; i < type.parts.length; i++) if (type.parts[i].k !== "array" && type.parts[i].view === undefined) return true;
        return false;
    }
    if (value === null) return (type.p & NULL) !== 0;
    if (type.o) return true;
    let isHeldToMembers = false;
    for (let i = 0; i < type.parts.length; i++) {
      const part = type.parts[i];
      if (part.k === "array") {
        if (isArray(value) && !isProxy(value)) return true;
      } else if (part.k === "global") {
        const constructor = getOwnPropertyDescriptor(global, part.name)?.value;
        if (typeof constructor !== "function" || hasProxyAbove(value) || apply(hasInstance, constructor, [value])) return true;
        if (under !== undefined && isOfKind(part.name, value)) return true;
      } else if (part.view !== undefined) isHeldToMembers = true;
      else if (part.members === undefined || isOfOneOf(part.members, value)) return true;
      else if (under !== undefined && isInstanceOfSomeClass(value)) return true;
    }
    return isHeldToMembers && canBeMade(type, value, under);
  }

  // Below a member, where a false word costs more than a missing one. The engine goes by the kind of the cell: a Date of another realm is a
  // Date, a SharedArrayBuffer an ArrayBuffer. And a class is told by its name here, which a program can change.
  function isOfKind(name, value) {
    const kind = apply(stringSlice, apply(objectToString, value, []), [8, -1]);
    return kind === name || (name === "ArrayBuffer" && kind === "SharedArrayBuffer");
  }

  function isInstanceOfSomeClass(value) {
    const prototype = getPrototypeOf(value);
    return prototype !== null && prototype !== ObjectPrototype && apply(objectToString, value, []) === "[object Object]";
  }

  function isObjectPrototypeOfAnotherRealm(prototype) {
    if (getPrototypeOf(prototype) !== null) return false;
    const constructor = getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return typeof constructor === "function" && getOwnPropertyDescriptor(constructor, "prototype")?.value === prototype && getOwnPropertyDescriptor(constructor, "name")?.value === "Object";
  }

  // The key of the shape that the object was made with by a literal of typed code, or that it has entered a record type as.
  function keyOfShapeTagged(tagged) {
    if (tagged >= ENTERED) return keysOfEntered[tagged - ENTERED];
    const steps = groupOf(tagged).steps;
    for (let i = 0; i < steps.length; i++) if (steps[i].kind === "made") return steps[i].shape;
  }

  function tagAsEntered(value, key) {
    let number = apply(mapGet, numbersOfEntered, [key]);
    if (number === undefined) {
      number = keysOfEntered.length;
      keysOfEntered[number] = key;
      apply(mapSet, numbersOfEntered, [key, number]);
    }
    tag(value, ENTERED + number);
  }

  // What becomes of an object where it enters a record type that admits no strangers. THE RULE IS THE ENGINE'S: class Coercion in
  // JavaScriptCore/aot/AOTTypedObject.cpp: coerce(), copy(), chooseLayout(), distanceTo(), mayBeCoerced(). Plain data is made one of a
  // shape that the program allocates: every own property that the shape has a field for is a writable, enumerable, configurable data
  // property whose value enters the type of the field in its turn; every field that is not optional is there; what the shape does not
  // name stays. Nothing is made of a Proxy, an array, a function or a native object. test/cli/aot-audit-members.test.ts holds the two to
  // each other.
  // It errs on the side of silence. The engine takes the nearest shape and fails with it: here any will do. Whether an object that typed
  // code has made is of the type goes by its layout in a build: a literal with the tag passes, and so does whatever has another prototype
  // and is not native: `new` on a class or a function of the program may have made it.
  // In a build the data has become a record from there on. Here it gets the tag that a literal of typed code gets, with the shape it has
  // entered as, so that it is walked once, and the site knows its Structure again without asking.
  function canBeMade(type, value, under) {
    if (isProxy(value) || isArray(value)) return false;
    const tagged = tagOf(value), parts = type.parts;
    if (tagged !== undefined && tagged < ENTERED) return true;
    const prototype = getPrototypeOf(value);
    if (prototype !== null && prototype !== ObjectPrototype) {
      if (hasProxyAbove(prototype)) return true;
      if (!isObjectPrototypeOfAnotherRealm(prototype)) {
        const kind = apply(stringSlice, apply(objectToString, value, []), [8, -1]);
        return kind === "Object" || typeof getOwnPropertyDescriptor(global, kind)?.value !== "function";
      }
    }
    const enteredAs = tagged !== undefined ? keysOfEntered[tagged - ENTERED] : undefined;
    hasLookedAtMembers = true;
    if (++numberLookedAt > 4096 || !isExtensible(value)) return true;
    for (let above = under; above !== undefined; above = above.under) if (above.value === value) return true;
    let names;
    const here = { value, under };
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].view === undefined) continue;
      const view = shapeBy(parts[i].view);
      if (view === null || view.made.length === 0) return true;
      for (let j = 0; j < view.made.length; j++) {
        if (view.made[j] === enteredAs) return true;
        const shape = shapeBy(view.made[j]);
        if (shape === null) return true;
        if (isOfShape(shape, value, (names ??= ownKeys(value)), here)) {
          if (tagged === undefined) tagAsEntered(value, view.made[j]);
          return true;
        }
      }
    }
    return false;
  }

  function isOfShape(shape, value, names, here) {
    const fields = shape.fields;
    let present = 0;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (typeof name !== "string" || !hasOwn(fields, name)) continue;
      const descriptor = getOwnPropertyDescriptor(value, name), field = fields[name];
      if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.writable || !descriptor.enumerable || !descriptor.configurable) return false;
      if (!(field.optional && descriptor.value === undefined) && !fits(field.to, descriptor.value, here)) return false;
      if (!field.optional) present++;
    }
    if (shape.required === undefined) {
      shape.required = 0;
      const all = keys(fields);
      for (let i = 0; i < all.length; i++) if (!fields[all[i]].optional) shape.required++;
    }
    return present === shape.required;
  }

  // Why: the engine's words, of kinds alone, never a value: Coercion::distanceTo() with `explains`, failToFit(), State::explainMismatch().
  // It explains why the first shape is not it: first what a look at each property shows, then what is missing, then what lies deeper.
  function reasonOf(type, value, path, depth) {
    let part, views = 0;
    for (let i = 0; i < type.parts.length; i++) {
      if (type.parts[i].k !== "class") continue;
      views++;
      if (part === undefined && type.parts[i].view !== undefined) part = type.parts[i];
    }
    if (part === undefined || typeof value !== "object" || value === null || isArray(value)) return;
    const prototype = isProxy(value) ? undefined : getPrototypeOf(value);
    if (prototype !== null && prototype !== ObjectPrototype && (prototype === undefined || hasProxyAbove(prototype) || !isObjectPrototypeOfAnotherRealm(prototype))) {
      if (views !== 1 || path !== "") return;
      const got = classOf(value, type);
      return apply(stringStartsWith, got, ["native "]) ? "a native object cannot be used as " + part.name : undefined;
    }
    const view = shapeBy(part.view), shape = view !== null && view.made.length !== 0 ? shapeBy(view.made[0]) : null;
    if (shape === null || depth > 8) return;
    const fields = shape.fields, names = ownKeys(value), at = name => "property '" + path + name + "'", here = { value };
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (typeof name !== "string" || !hasOwn(fields, name)) continue;
      const descriptor = getOwnPropertyDescriptor(value, name), held = descriptor.value, to = fields[name].to;
      if (descriptor.get !== undefined || descriptor.set !== undefined) return at(name) + " is an accessor";
      if (!(descriptor.writable && descriptor.enumerable && descriptor.configurable)) return at(name) + (!descriptor.writable ? " is read only" : !descriptor.enumerable ? " is not enumerable" : " is not configurable");
      if ((fields[name].optional && held === undefined) || fits(to, held, here)) continue;
      let canBeLookedInto = typeof held === "object" && held !== null && !isArray(held) && !isProxy(held);
      if (canBeLookedInto) {
        canBeLookedInto = false;
        for (let j = 0; j < to.parts.length; j++) if (to.parts[j].view !== undefined) canBeLookedInto = true;
      }
      if (!canBeLookedInto) return at(name) + ": expected " + to.t + ", got " + classOf(held, to);
    }
    const all = keys(fields);
    for (let i = 0; i < all.length; i++) if (!fields[all[i]].optional && !hasOwn(value, all[i])) return at(all[i]) + " is missing in " + classOf(value, type) + " but required in " + shape.name;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (typeof name !== "string" || !hasOwn(fields, name)) continue;
      const held = getOwnPropertyDescriptor(value, name).value;
      if (!(fields[name].optional && held === undefined) && !fits(fields[name].to, held, here)) return reasonOf(fields[name].to, held, path + name + ".", depth + 1) ?? at(name) + ": expected " + fields[name].to.t + ", got " + classOf(held, fields[name].to);
    }
  }

  function hasProxyAbove(value) {
    for (let object = value; object !== null; object = getPrototypeOf(object)) if (isProxy(object)) return true;
    return false;
  }

  function isOfOneOf(names, value) {
    if (isProxy(value)) return true;
    for (let prototype = getPrototypeOf(value); prototype !== null; prototype = getPrototypeOf(prototype)) {
      if (isProxy(prototype)) return true;
      const constructor = getOwnPropertyDescriptor(prototype, "constructor")?.value;
      const named = typeof constructor === "function" ? getOwnPropertyDescriptor(constructor, "name") : undefined, name = named?.value;
      if (named !== undefined && (named.writable || named.enumerable)) return true;
      for (let i = 0; i < names.length; i++) if (names[i] === name) return true;
    }
    return false;
  }

  function classOf(value, type) {
    const kind = typeof value;
    if (kind === "number" && type.i !== undefined) return isInteger(value) && !is(value, -0) && value >= -2147483648 && value <= 2147483647 ? "number, out of range" : "number, no int32";
    if (kind === "function") return apply(stringStartsWith, apply(functionToString, value, []), ["class"]) ? "class" : "function";
    if (kind !== "object") return kind;
    if (value === null) return "null";
    if (isProxy(value)) return "native ProxyObject";
    if (isArray(value)) return "Array";
    const prototype = getPrototypeOf(value);
    if (prototype === null || prototype === ObjectPrototype) return "untyped object";
    if (hasProxyAbove(prototype)) return "object";
    const tag = apply(stringSlice, apply(objectToString, value, []), [8, -1]);
    if (tag !== "Object" && typeof getOwnPropertyDescriptor(global, tag)?.value === "function") return "native " + tag;
    const constructor = getOwnPropertyDescriptor(prototype, "constructor")?.value;
    const name = typeof constructor === "function" ? getOwnPropertyDescriptor(constructor, "name")?.value : undefined;
    return typeof name === "string" && name ? name : "object";
  }

  function callers() {
    if (ErrorConstructor.prepareStackTrace !== prepareStackTraceAtFirst) return "";
    const stack = new ErrorConstructor().stack;
    if (typeof stack !== "string") return "";
    const lines = apply(stringSplit, stack, ["\n"]);
    let found = "", frames = 0;
    for (let i = 1; i < lines.length && frames < 4; i++) {
      const line = lines[i];
      const open = apply(stringLastIndexOf, line, ["("]);
      let place = open >= 0 ? apply(stringSlice, line, [open + 1, -1]) : apply(stringSlice, line, [apply(stringIndexOf, line, ["at "]) + 3]);
      if (!apply(stringIncludes, place, ["/"]) || apply(stringIncludes, place, ["aot-audit"]) || apply(stringIncludes, place, ["aot_audit"]) || apply(stringIncludes, place, ["audit-preload"])) continue;
      if (frames++ === 0) continue;
      place = apply(stringSlice, place, [0, apply(stringLastIndexOf, place, [":"])]);
      if (apply(stringStartsWith, place, [workingDirectory + "/"])) place = apply(stringSlice, place, [workingDirectory.length + 1]);
      found += (found ? " < " : "") + place;
    }
    return found;
  }

  function report(file, step, kind, type, value, action) {
    const got = classOf(value, type);
    const id = kind === step.otherKind ? step.otherId : step.id;
    const count = (apply(mapGet, counts, [id + " " + got]) ?? 0) + 1;
    apply(mapSet, counts, [id + " " + got, count]);
    let power = count;
    while (power % 10 === 0) power /= 10;
    if (power !== 1) return;
    const from = callers(), reason = action === "would-throw" ? reasonOf(type, value, "", 0) : undefined;
    if (isJSON) return writeJSON(id, kind, file, step, step.on, type, got, action, count, from, reason);
    write("[aot] type-error " + id + " " + kind + " " + file + ":" + step.line + ":" + step.col + " (" + step.fn + "): " + (step.on !== undefined ? "on " + step.on + "; " : "") + "expected " + type.t + ", got " + got + "; " + action + "; count " + count + (reason !== undefined ? "; reason " + reason : "") + (step.callId !== undefined ? "; call " + step.callId : "") + (from ? "; from " + from : ""));
  }

  function writeJSON(id, kind, file, step, on, type, got, action, count, from, reason) {
    let line = '{"aot":"type-error","id":"' + id + '","kind":"' + kind + '","what":' + stringify(step.what) + ',"file":' + stringify(file) + ',"line":' + step.line + ',"col":' + step.col + ',"fn":' + stringify(step.fn);
    if (on !== undefined) line += ',"on":' + stringify(on);
    if (type !== undefined) line += ',"expected":' + stringify(type.t) + ',"got":' + stringify(got);
    line += ',"action":"' + action + '","count":' + count;
    if (reason !== undefined) line += ',"reason":' + stringify(reason);
    if (step.callId !== undefined) line += ',"callId":"' + step.callId + '"';
    if (from) {
      const places = apply(stringSplit, from, [" < "]);
      for (let i = 0; i < places.length; i++) line += (i === 0 ? ',"from":[' : ",") + stringify(places[i]);
      line += "]";
    }
    write(line + "}");
  }

  function shapeBy(key) {
    let shape = apply(mapGet, shapes, [key]);
    if (shape === undefined) {
      shape = parse(describe(key));
      apply(mapSet, shapes, [key, shape]);
    }
    return shape;
  }

  function shapeOf(object) {
    const maker = tagOf(object);
    if (maker !== undefined) {
      const key = keyOfShapeTagged(maker);
      return key !== undefined ? shapeBy(key) : null;
    }
    if (isProxy(object)) return null;
    for (let prototype = getPrototypeOf(object); prototype !== null; prototype = getPrototypeOf(prototype)) {
      if (isProxy(prototype)) return null;
      const constructor = getOwnPropertyDescriptor(prototype, "constructor")?.value;
      if (typeof constructor !== "function" || getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype) return null;
      const name = getOwnPropertyDescriptor(constructor, "name")?.value;
      if (typeof name !== "string" || name === "") return null;
      const shape = shapeBy("class " + name);
      if (shape !== null) return shape;
    }
    return null;
  }

  function shapeOfPrototype(object) {
    const constructor = getOwnPropertyDescriptor(object, "constructor")?.value;
    if (typeof constructor !== "function" || getOwnPropertyDescriptor(constructor, "prototype")?.value !== object) return null;
    const name = getOwnPropertyDescriptor(constructor, "name")?.value;
    return typeof name === "string" && name !== "" ? shapeBy("class " + name) : null;
  }

  function reportRule(file, step, kind, on, type, value) {
    const got = type === undefined ? "" : classOf(value, type);
    const id = kind === step.otherKind ? step.otherId : step.id;
    const count = (apply(mapGet, counts, [id + " " + on + " " + got]) ?? 0) + 1;
    apply(mapSet, counts, [id + " " + on + " " + got, count]);
    let power = count;
    while (power % 10 === 0) power /= 10;
    if (power !== 1) return;
    const from = callers();
    if (isJSON) return writeJSON(id, kind, file, step, on, type, got, "would-throw", count, from);
    write("[aot] type-error " + id + " " + kind + " " + file + ":" + step.line + ":" + step.col + " (" + step.fn + "): on " + on + (type === undefined ? "" : "; expected " + type.t + ", got " + got) + "; would-throw; count " + count + (from ? "; from " + from : ""));
  }

  function validate(file, step, object) {
    const shape = shapeOf(object);
    if (shape === null) return;
    const names = keys(shape.fields);
    for (let i = 0; i < names.length; i++) {
      const name = names[i], field = shape.fields[name], descriptor = getOwnPropertyDescriptor(object, name);
      if (descriptor === undefined) continue;
      if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.writable || !descriptor.enumerable || !descriptor.configurable) {
        if (step.kind === "field-redefine") reportRule(file, step, step.kind, shape.name + "." + name);
      } else if (!fits(field.to, descriptor.value) && !(field.optional && descriptor.value === undefined)) reportRule(file, step, "field-store-untyped", shape.name + "." + name, field.to, descriptor.value);
    }
  }

  function rule(file, step, value, id) {
    if (step.stores) {
      let at = depth - 1;
      while (at >= 0 && receivers[at].pair !== step.pair) at--;
      if (at < 0) return;
      const top = receivers[at];
      while (depth > at) receivers[--depth] = undefined;
      if (top.shape === null) return;
      const field = top.shape.fields[step.name];
      if (!fits(field.to, value) && !(field.optional && value === undefined)) reportRule(file, step, step.kind, top.shape.name + "." + step.name, field.to, value);
      return;
    }
    if (typeof value !== "object" && typeof value !== "function") return;
    if (value === null) return;
    if (step.kind === "made") return tag(value, id);
    if (step.validates) return validate(file, step, value);
    if (step.receives) {
      const ofPrototype = typeof value === "object" ? shapeOfPrototype(value) : null;
      if (ofPrototype !== null && !hasOwn(value, step.name)) reportRule(file, step, step.kind, ofPrototype.name + ".prototype");
      const shape = ofPrototype === null ? shapeOf(value) : null;
      receivers[depth++] = { pair: step.pair, shape: shape !== null && hasOwn(shape.fields, step.name) ? shape : null };
      return;
    }
    const shape = shapeOf(value);
    if (shape === null) return;
    if (step.kind === "object-set-prototype") return reportRule(file, step, step.kind, shape.name);
    const field = hasOwn(shape.fields, step.name) ? shape.fields[step.name] : undefined;
    if (field === undefined) return;
    if (step.kind === "field-delete" && !field.optional) reportRule(file, step, step.kind, shape.name + "." + step.name);
  }

  function isReadByIndex(array) {
    if (array[iterator] !== arrayIterator) return false;
    for (let i = 0; i < array.length; i++) {
      const descriptor = getOwnPropertyDescriptor(array, i);
      if (descriptor !== undefined && (descriptor.get !== undefined || descriptor.set !== undefined)) return false;
    }
    return true;
  }

  function waits(step, value) {
    if (step.unsure !== 2 && (step.unsure !== 1 || (value !== null && value !== undefined))) return false;
    if (!hasSaidThatSomeWait) {
      hasSaidThatSomeWait = true;
      write("[aot] note: a file changed: some of its checks are paused until the whole program has been analyzed again in the background");
    }
    return true;
  }

  function groupOf(id) {
    let group = groups[id];
    if (group === undefined) groups[id] = group = parse(describe(id));
    return group;
  }

  function passed(group, value, id) {
    if (group.unsure || group.step) return;
    const steps = group.steps;
    if (typeof value === "object" || typeof value === "function") {
      if (hasLookedAtMembers && tagOf(value) === undefined) return;
      for (let i = 0; i < steps.length; i++) if (steps[i].to === undefined) return;
      return 1;
    }
    if (typeof value !== "number") return;
    let least = -2147483648, most = 2147483647;
    for (let i = 0; i < steps.length; i++) {
      const type = steps[i].to;
      if (type === undefined || steps[i].what === "IteratorOpen") return;
      if ((type.p & NUMBER) !== 0) continue;
      if (type.i === undefined) return;
      if (type.i[0] > least) least = type.i[0];
      if (type.i[1] < most) most = type.i[1];
    }
    remember(id, least, most);
  }

  return function check(value, id, now) {
    if (now !== generation) {
      generation = now;
      groups.length = 0;
      apply(mapClear, shapes, []);
    }
    const group = groupOf(id), steps = group.steps, file = group.file;
    hasLookedAtMembers = false;
    numberLookedAt = 0;
    if (group.silent || steps.length === 0) return 4;
    if (steps.length === 1 && steps[0].kind === "made" && steps[0].unsure === undefined) return 3;
    if (group.parameter) {
      const step = steps[0], type = step.to;
      if (fits(type, value)) return passed(group, value, id);
      if ((typeof value === "object" || typeof value === "function") && (type.o || type.fn || type.parts.length)) return;
      if (whatACastMadeOf(type, value) !== undefined) return;
      if (waits(step, value)) return;
      if (hasLast && is(lastValue, value) && lastType === type.t) {
        hasLast = false;
        const from = callers();
        if (from === lastPlace || apply(stringStartsWith, from, [lastPlace + " "])) return;
      }
      report(file, step, step.kind, type, value, "would-throw");
      return;
    }
    let held = value, hasFailed = false;
    if (group.step) held = typeof value === "bigint" ? value + toBigInt(group.step) : value + group.step;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i], type = step.to;
      if (type === undefined) {
        if (step.unsure === undefined) rule(file, step, value, id);
        continue;
      }
      if (step.what === "IteratorOpen") {
        if (held === null || held === undefined) continue;
        if (!isArray(held) || isProxy(held) || !isReadByIndex(held)) {
          report(file, step, step.kind, type, held, "would-throw");
          hasFailed = true;
        }
        continue;
      }
      if (step.what === "Coerce" && (typeof held === "object" ? held !== null : typeof held === "function") && (type.o || type.fn || type.parts.length !== 0)) continue;
      if (fits(type, held)) continue;
      if (waits(step, held)) return;
      if (step.after !== undefined) {
        for (let j = 0; j < step.after.length; j++) if (apply(mapGet, converted, [file + ":" + step.after[j]])) return;
      }
      if (step.what !== "Coerce") {
        const made = whatACastMadeOf(type, held);
        if (made !== undefined) {
          held = made;
          hasFailed = true;
          continue;
        }
        report(file, step, step.kind, type, held, "would-throw");
        lastValue = held;
        lastType = type.t;
        lastPlace = file + ":" + step.line;
        hasLast = true;
        return;
      }
      if (step.result !== undefined && fits(step.result, held)) continue;
      const result = cast(type, held);
      if (result === undefined) return report(file, step, "as-refuse", type, held, "would-throw");
      report(file, step, step.kind, type, held, "would-convert");
      apply(mapSet, converted, [file + ":" + step.line + ":" + step.col, true]);
      const results = numberOfResultsOfCasts > 4096 ? null : apply(mapGet, resultsOfCasts, [held]);
      if (results === undefined) {
        apply(mapSet, resultsOfCasts, [held, [result]]);
        if (++numberOfResultsOfCasts > 4096) {
          apply(mapClear, resultsOfCasts, []);
          write("[aot] note: `as` has converted more than 4096 different values: from here on, a string, number or boolean that fails a check is not reported if a conversion would make it pass");
        }
      } else if (results !== null && whatACastMadeOf(type, held) === undefined) results[results.length] = result;
      held = result;
      hasFailed = true;
    }
    if (!hasFailed) return passed(group, value, id);
  };
})
