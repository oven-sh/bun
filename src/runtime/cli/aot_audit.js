(function (describe, write, isProxy, workingDirectory, remember, tag, tagOf) {
  "use strict";
  const UNDEFINED = 1, NULL = 2, FALSE = 4, TRUE = 8, NUMBER = 16, STRING = 32, SYMBOL = 64, BIGINT = 128;
  const global = globalThis;
  const { isArray } = Array;
  const { is, getPrototypeOf, getOwnPropertyDescriptor } = Object;
  const { isInteger } = Number;
  const { parse } = JSON;
  const { apply } = Reflect;
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
  const groups = [];
  let lastValue, lastType = "", lastPlace = "", hasLast = false, hasSaidThatSomeWait = false;

  function fits(type, value) {
    switch (typeof value) {
      case "undefined": return (type.p & UNDEFINED) !== 0;
      case "boolean": return (type.p & (value ? TRUE : FALSE)) !== 0;
      case "number": return (type.p & NUMBER) !== 0 || (type.i !== undefined && isInteger(value) && !is(value, -0) && value >= type.i[0] && value <= type.i[1]);
      case "string": return (type.p & STRING) !== 0;
      case "symbol": return (type.p & SYMBOL) !== 0;
      case "bigint": return (type.p & BIGINT) !== 0;
      case "function":
        if (type.o || type.fn) return true;
        for (let i = 0; i < type.parts.length; i++) if (type.parts[i].k !== "array") return true;
        return false;
    }
    if (value === null) return (type.p & NULL) !== 0;
    if (type.o) return true;
    for (let i = 0; i < type.parts.length; i++) {
      const part = type.parts[i];
      if (part.k === "array") {
        if (isArray(value) && !isProxy(value)) return true;
      } else if (part.k === "global") {
        const constructor = getOwnPropertyDescriptor(global, part.name)?.value;
        if (typeof constructor !== "function" || hasProxyAbove(value) || apply(hasInstance, constructor, [value])) return true;
      } else if (part.members === undefined || isOfOneOf(part.members, value)) return true;
    }
    return false;
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
      const name = typeof constructor === "function" ? getOwnPropertyDescriptor(constructor, "name")?.value : undefined;
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
    if (prototype === null || prototype === ObjectPrototype) return "plain object";
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
    const from = callers();
    write("[aot] type-error " + id + " " + kind + " " + file + ":" + step.line + ":" + step.col + " (" + step.fn + "): " + (step.on !== undefined ? "on " + step.on + "; " : "") + "expected " + type.t + ", got " + got + "; " + action + "; count " + count + (from ? "; from " + from : ""));
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
      const steps = groupOf(maker).steps;
      for (let i = 0; i < steps.length; i++) if (steps[i].kind === "made") return shapeBy(steps[i].shape);
      return null;
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
      write("[aot] note: some checks wait until the whole program has been looked at again");
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
    if (group.silent || steps.length === 0) return 4;
    if (steps.length === 1 && steps[0].kind === "made" && steps[0].unsure === undefined) return 3;
    if (group.parameter) {
      const step = steps[0], type = step.to;
      if (fits(type, value)) return passed(group, value, id);
      if ((typeof value === "object" || typeof value === "function") && (type.o || type.fn || type.parts.length)) return;
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
      if (fits(type, held)) continue;
      if (waits(step, held)) return;
      if (step.after !== undefined) {
        for (let j = 0; j < step.after.length; j++) if (apply(mapGet, converted, [file + ":" + step.after[j]])) return;
      }
      if (step.what !== "Coerce") {
        report(file, step, step.kind, type, held, "would-throw");
        lastValue = held;
        lastType = type.t;
        lastPlace = file + ":" + step.line;
        hasLast = true;
        return;
      }
      if (step.result !== undefined && fits(step.result, held)) continue;
      const kind = typeof held;
      const hasNumber = (type.p & NUMBER) !== 0 || type.i !== undefined, hasString = (type.p & STRING) !== 0, hasBoolean = (type.p & (TRUE | FALSE)) !== 0;
      const isConvertible = kind !== "object" && kind !== "function" && (hasString ? kind !== "symbol" : hasNumber ? kind !== "symbol" && kind !== "bigint" : hasBoolean);
      const result = !isConvertible ? held : hasString ? toString(held) : hasNumber ? toNumber(held) : toBoolean(held);
      if (!isConvertible || !fits(type, result)) return report(file, step, "as-refuse", type, held, "would-throw");
      report(file, step, step.kind, type, held, "would-convert");
      apply(mapSet, converted, [file + ":" + step.line + ":" + step.col, true]);
      held = result;
      hasFailed = true;
    }
    if (!hasFailed) return passed(group, value, id);
  };
})
