(function (
  describe,
  write,
  isProxy,
  workingDirectory,
  remember,
  tag,
  tagOf,
  cellKind,
  isAnyModuleMocked,
  isPlainArray,
  fixClassPrototype,
  guardInstancesOf,
  setGuard,
  describeValue,
  waitForWholeProgramAnalysis,
) {
  const checksMockValues = true;
  let reportsUncertain = false;
  ("use strict");
  const UNDEFINED = 1,
    NULL = 2,
    FALSE = 4,
    TRUE = 8,
    NUMBER = 16,
    STRING = 32,
    SYMBOL = 64,
    BIGINT = 128;
  const global = globalThis;
  const { isArray } = Array;
  const { is, getPrototypeOf, getOwnPropertyDescriptor, isExtensible } = Object;
  const { isInteger } = Number;
  const { parse, stringify } = JSON;
  const isJSON = describe("format") === "json";
  const isEnforcing = describe("isEnforcing") === "true";
  const logs = describe("logs") === "true";
  let refusal,
    handedBack,
    hasReturnedValue = false;
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
  const originalPrepareStackTrace = Error.prepareStackTrace;
  const toString = String,
    toNumber = Number,
    toBoolean = Boolean,
    toBigInt = BigInt;
  const mapGet = Map.prototype.get,
    mapSet = Map.prototype.set,
    mapClear = Map.prototype.clear;
  const { hasOwn } = Object;
  const shapes = new Map();
  const receivers = [];
  const { keys } = Object;
  let depth = 0,
    generation;
  const counts = new Map();
  const converted = new Map();
  const castResults = new Map();
  let castResultCount = 0;
  const groups = [];
  let lastValue,
    lastType = "",
    lastPlace = "",
    hasLast = false,
    hasReportedPending = false;
  const ENTERED = 0x40000000,
    enteredKeys = [],
    enteredIds = new Map();
  let hasInspectedMembers = false,
    inspectedCount = 0;

  function cast(type, value) {
    const kind = typeof value;
    const hasNumber = (type.p & NUMBER) !== 0 || type.i !== undefined,
      hasString = (type.p & STRING) !== 0,
      hasBoolean = (type.p & (TRUE | FALSE)) !== 0;
    if (
      (kind === "object" && value !== null) ||
      kind === "function" ||
      !(hasString ? kind !== "symbol" : hasNumber ? kind !== "symbol" && kind !== "bigint" : hasBoolean)
    )
      return;
    const result = hasString ? toString(value) : hasNumber ? toNumber(value) : toBoolean(value);
    if (fits(type, result)) return result;
  }

  function castResultFor(type, value) {
    if (castResultCount > 4096) return value === undefined || value === null ? undefined : cast(type, value);
    const results = apply(mapGet, castResults, [value]);
    if (results !== undefined) for (let i = 0; i < results.length; i++) if (fits(type, results[i])) return results[i];
  }

  function fits(type, value, under) {
    switch (typeof value) {
      case "undefined":
        return (type.p & UNDEFINED) !== 0;
      case "boolean":
        return (type.p & (value ? TRUE : FALSE)) !== 0;
      case "number":
        return (
          (type.p & NUMBER) !== 0 ||
          (type.i !== undefined && isInteger(value) && !is(value, -0) && value >= type.i[0] && value <= type.i[1])
        );
      case "string":
        return (type.p & STRING) !== 0;
      case "symbol":
        return (type.p & SYMBOL) !== 0;
      case "bigint":
        return (type.p & BIGINT) !== 0;
      case "function":
        if (type.o || type.fn) return true;
        for (let i = 0; i < type.parts.length; i++) {
          const part = type.parts[i];
          if (
            part.k === "global" && isEnforcing
              ? cellKind(part.name, value) !== false
              : part.k !== "array" && part.view === undefined
          )
            return true;
        }
        return under === undefined && mayStay(type, value);
    }
    if (value === null) return (type.p & NULL) !== 0;
    if (type.o) return true;
    let checksMembers = false;
    for (let i = 0; i < type.parts.length; i++) {
      const part = type.parts[i];
      if (part.k === "array") {
        if (isArray(value) && !isProxy(value)) return true;
      } else if (part.k === "global" && isEnforcing) {
        const kind = cellKind(part.name === "SharedArrayBuffer" ? "ArrayBuffer" : part.name, value);
        if (kind !== false) return true;
      } else if (part.k === "global") {
        const constructor = getOwnPropertyDescriptor(global, part.name)?.value;
        if (typeof constructor !== "function" || hasProxyAbove(value) || apply(hasInstance, constructor, [value]))
          return true;
        if (isOfKind(part.name, value)) return true;
      } else if (part.view !== undefined) checksMembers = true;
      else if (part.members === undefined || matchesAnyOf(part.members, value)) return true;
      else if (under !== undefined && isInstanceOfSomeClass(value)) return true;
    }
    return checksMembers && canBeAllocated(type, value, under);
  }

  function isOfKind(name, value) {
    const kind = apply(stringSlice, apply(objectToString, value, []), [8, -1]);
    return kind === name || (name === "ArrayBuffer" && kind === "SharedArrayBuffer");
  }

  function isInstanceOfSomeClass(value) {
    const prototype = getPrototypeOf(value);
    return (
      prototype !== null && prototype !== ObjectPrototype && apply(objectToString, value, []) === "[object Object]"
    );
  }

  function isOtherRealmObjectPrototype(prototype) {
    if (getPrototypeOf(prototype) !== null) return false;
    const constructor = getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return (
      typeof constructor === "function" &&
      getOwnPropertyDescriptor(constructor, "prototype")?.value === prototype &&
      getOwnPropertyDescriptor(constructor, "name")?.value === "Object"
    );
  }

  function taggedShapeKey(tagged) {
    if (tagged >= ENTERED) return enteredKeys[tagged - ENTERED];
    const steps = groupOf(tagged).steps;
    for (let i = 0; i < steps.length; i++) if (steps[i].kind === "made") return steps[i].shape;
  }

  function tagAsEntered(value, key) {
    let number = apply(mapGet, enteredIds, [key]);
    if (number === undefined) {
      number = enteredKeys.length;
      enteredKeys[number] = key;
      apply(mapSet, enteredIds, [key, number]);
    }
    tag(value, ENTERED + number);
  }

  function canBeAllocated(type, value, under) {
    return canBeCopied(type, value, under) || (under === undefined && mayStay(type, value));
  }

  function acceptsOtherLayouts(type) {
    const parts = type.parts;
    for (let i = 0; i < parts.length; i++)
      if (parts[i].view !== undefined && shapeBy(parts[i].view)?.stays) return true;
    return false;
  }

  function mayStay(type, value) {
    const parts = type.parts;
    if (!acceptsOtherLayouts(type) || isAllPlainData(value)) return false;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].view === undefined) continue;
      const view = shapeBy(parts[i].view);
      if (view === null) return true;
      for (let j = 0; j < view.made.length; j++) {
        const shape = shapeBy(view.made[j]);
        if (shape === null || maySatisfyWhenReadByName(shape, value)) return true;
      }
    }
    return false;
  }

  function isAllPlainData(value) {
    if (
      isProxy(value) ||
      isArray(value) ||
      !isExtensible(value) ||
      apply(objectToString, value, []) !== "[object Object]"
    )
      return false;
    const prototype = getPrototypeOf(value);
    if (prototype !== null && prototype !== ObjectPrototype) return false;
    const names = ownKeys(value);
    for (let i = 0; i < names.length; i++) {
      const descriptor = getOwnPropertyDescriptor(value, names[i]);
      if (
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !descriptor.writable ||
        !descriptor.enumerable ||
        !descriptor.configurable
      )
        return false;
    }
    return true;
  }

  function maySatisfyWhenReadByName(shape, value) {
    const fields = shape.fields,
      names = keys(fields);
    for (let i = 0; i < names.length; i++) {
      const field = fields[names[i]];
      let descriptor;
      for (let holder = value; holder !== null && descriptor === undefined; holder = getPrototypeOf(holder)) {
        if (isProxy(holder)) descriptor = null;
        else descriptor = getOwnPropertyDescriptor(holder, names[i]);
        if (descriptor === null) break;
      }
      if (descriptor === null) continue;
      if (descriptor === undefined) {
        if (field.optional) continue;
        return false;
      }
      if (descriptor.get !== undefined || descriptor.set !== undefined) continue;
      const held = descriptor.value;
      if ((held === null || (typeof held !== "object" && typeof held !== "function")) && !fits(field.to, held))
        return false;
    }
    return true;
  }

  function canBeCopied(type, value, under) {
    if (isProxy(value) || isArray(value)) return false;
    const tagged = tagOf(value),
      parts = type.parts;
    if (tagged !== undefined && tagged < ENTERED && isAllocatedAsMember(parts, taggedShapeKey(tagged))) return true;
    const prototype = getPrototypeOf(value);
    if (prototype !== null && prototype !== ObjectPrototype) {
      if (hasProxyAbove(prototype)) return true;
      if (!isOtherRealmObjectPrototype(prototype)) {
        const kind = apply(stringSlice, apply(objectToString, value, []), [8, -1]);
        return kind === "Object" || typeof getOwnPropertyDescriptor(global, kind)?.value !== "function";
      }
    }
    const enteredAs = tagged !== undefined ? enteredKeys[tagged - ENTERED] : undefined;
    hasInspectedMembers = true;
    if (++inspectedCount > 4096 || !isExtensible(value)) return true;
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
        if (matchesShape(shape, value, (names ??= ownKeys(value)), here)) {
          if (tagged === undefined) tagAsEntered(value, view.made[j]);
          return true;
        }
      }
    }
    return false;
  }

  function isAllocatedAsMember(parts, key) {
    if (key === undefined || key === "") return true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].view === undefined) continue;
      const view = shapeBy(parts[i].view);
      if (view === null) return true;
      for (let j = 0; j < view.members.length; j++) if (view.members[j] === key) return true;
    }
    return false;
  }

  function matchesShape(shape, value, names, here) {
    const fields = shape.fields;
    let present = 0;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (typeof name !== "string" || !hasOwn(fields, name)) continue;
      const descriptor = getOwnPropertyDescriptor(value, name),
        field = fields[name];
      if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) return false;
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

  function reasonOf(type, value, path, depth) {
    let part,
      views = 0;
    for (let i = 0; i < type.parts.length; i++) {
      if (type.parts[i].k !== "class") continue;
      views++;
      if (part === undefined && type.parts[i].view !== undefined) part = type.parts[i];
    }
    if (part === undefined || typeof value !== "object" || value === null || isArray(value)) return;
    const prototype = isProxy(value) ? undefined : getPrototypeOf(value);
    if (
      prototype !== null &&
      prototype !== ObjectPrototype &&
      (prototype === undefined || hasProxyAbove(prototype) || !isOtherRealmObjectPrototype(prototype))
    ) {
      if (views !== 1 || path !== "") return;
      const got = classOf(value, type);
      return apply(stringStartsWith, got, ["native "]) ? "a native object cannot be used as " + part.name : undefined;
    }
    const view = shapeBy(part.view),
      shape = view !== null && view.made.length !== 0 ? shapeBy(view.made[0]) : null;
    if (shape === null || depth > 8) return;
    const fields = shape.fields,
      names = ownKeys(value),
      at = name => "property '" + path + name + "'",
      here = { value };
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (typeof name !== "string" || !hasOwn(fields, name)) continue;
      const descriptor = getOwnPropertyDescriptor(value, name),
        held = descriptor.value,
        to = fields[name].to;
      if (descriptor.get !== undefined || descriptor.set !== undefined) return at(name) + " is an accessor";
      if (!descriptor.enumerable) return at(name) + " is not enumerable";
      if ((fields[name].optional && held === undefined) || fits(to, held, here)) continue;
      let isInspectable = typeof held === "object" && held !== null && !isArray(held) && !isProxy(held);
      if (isInspectable) {
        isInspectable = false;
        for (let j = 0; j < to.parts.length; j++) if (to.parts[j].view !== undefined) isInspectable = true;
      }
      if (!isInspectable)
        return at(name) + ": expected " + to.t + ", got " + (isEnforcing ? shown(held, to) : classOf(held, to));
    }
    const all = keys(fields);
    for (let i = 0; i < all.length; i++)
      if (!fields[all[i]].optional && !hasOwn(value, all[i]))
        return at(all[i]) + " is missing in " + classOf(value, type) + " but required in " + shape.name;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (typeof name !== "string" || !hasOwn(fields, name)) continue;
      const held = getOwnPropertyDescriptor(value, name).value;
      if (!(fields[name].optional && held === undefined) && !fits(fields[name].to, held, here))
        return (
          reasonOf(fields[name].to, held, path + name + ".", depth + 1) ??
          at(name) +
            ": expected " +
            fields[name].to.t +
            ", got " +
            (isEnforcing ? shown(held, fields[name].to) : classOf(held, fields[name].to))
        );
    }
  }

  function hasProxyAbove(value) {
    for (let object = value; object !== null; object = getPrototypeOf(object)) if (isProxy(object)) return true;
    return false;
  }

  function matchesAnyOf(names, value) {
    if (isProxy(value)) return true;
    for (let prototype = getPrototypeOf(value); prototype !== null; prototype = getPrototypeOf(prototype)) {
      if (isProxy(prototype)) return true;
      const constructor = getOwnPropertyDescriptor(prototype, "constructor")?.value;
      const named = typeof constructor === "function" ? getOwnPropertyDescriptor(constructor, "name") : undefined,
        name = named?.value;
      if (named !== undefined && (named.writable || named.enumerable)) return true;
      for (let i = 0; i < names.length; i++) if (names[i] === name) return true;
    }
    return false;
  }

  function classOf(value, type) {
    const kind = typeof value;
    if (kind === "number" && type.i !== undefined)
      return isInteger(value) && !is(value, -0) && value >= -2147483648 && value <= 2147483647
        ? "number, out of range"
        : "number, no int32";
    if (kind === "function")
      return apply(stringStartsWith, apply(functionToString, value, []), ["class"]) ? "class" : "function";
    if (kind !== "object") return kind;
    if (value === null) return "null";
    if (isProxy(value)) return "native ProxyObject";
    if (isArray(value)) return "Array";
    const prototype = getPrototypeOf(value);
    if (prototype === null || prototype === ObjectPrototype) {
      const tagged = tagOf(value);
      return (tagged !== undefined && tagged < ENTERED && shapeOf(value)?.name) || "untyped object";
    }
    if (hasProxyAbove(prototype)) return "object";
    const tag = apply(stringSlice, apply(objectToString, value, []), [8, -1]);
    if (tag !== "Object" && typeof getOwnPropertyDescriptor(global, tag)?.value === "function") return "native " + tag;
    const constructor = getOwnPropertyDescriptor(prototype, "constructor")?.value;
    const name = typeof constructor === "function" ? getOwnPropertyDescriptor(constructor, "name")?.value : undefined;
    return typeof name === "string" && name ? name : "object";
  }

  function callers() {
    if (ErrorConstructor.prepareStackTrace !== originalPrepareStackTrace) return "";
    const stack = new ErrorConstructor().stack;
    if (typeof stack !== "string") return "";
    const lines = apply(stringSplit, stack, ["\n"]);
    let found = "",
      frames = 0;
    for (let i = 1; i < lines.length && frames < 4; i++) {
      const line = lines[i];
      const open = apply(stringLastIndexOf, line, ["("]);
      let place =
        open >= 0
          ? apply(stringSlice, line, [open + 1, -1])
          : apply(stringSlice, line, [apply(stringIndexOf, line, ["at "]) + 3]);
      if (!apply(stringIncludes, place, ["/"])) continue;
      if (frames++ === 0) continue;
      place = apply(stringSlice, place, [0, apply(stringLastIndexOf, place, [":"])]);
      if (apply(stringStartsWith, place, [workingDirectory + "/"]))
        place = apply(stringSlice, place, [workingDirectory.length + 1]);
      found += (found ? " < " : "") + place;
    }
    return found;
  }

  function nameByTag(value) {
    const tagged = tagOf(value);
    if (tagged !== undefined && tagged >= ENTERED) return shapeBy(enteredKeys[tagged - ENTERED])?.name;
    if (tagged !== undefined) {
      const steps = groupOf(tagged).steps;
      for (let i = 0; i < steps.length; i++)
        if (steps[i].kind === "made") return steps[i].named ?? shapeBy(steps[i].shape)?.name;
      return;
    }
    for (
      let prototype = getPrototypeOf(value);
      prototype !== null && !isProxy(prototype);
      prototype = getPrototypeOf(prototype)
    ) {
      const made = tagOf(prototype);
      if (made !== undefined && made < ENTERED && groupOf(made).parameter) return groupOf(made).steps[0].named;
    }
  }

  function shown(value, type) {
    const kind = typeof value;
    if (isEnforcing) {
      if (kind === "function" && apply(stringStartsWith, apply(functionToString, value, []), ["class"])) {
        const name = getOwnPropertyDescriptor(value, "name")?.value;
        return "class " + (typeof name === "string" ? name : "");
      }
      const name = kind === "object" && value !== null && !isProxy(value) ? nameByTag(value) : undefined;
      return name !== undefined && name !== null ? name : describeValue(value);
    }
    if (kind === "number") return "number " + (is(value, -0) ? "-0" : value);
    if (kind === "boolean") return "boolean " + value;
    if (kind === "string")
      return 'string "' + (value.length > 40 ? apply(stringSlice, value, [0, 40]) + '..."' : value + '"');
    const got = classOf(value, type);
    if (kind !== "function") return got;
    const name = getOwnPropertyDescriptor(value, "name")?.value;
    return typeof name === "string" && name ? got + " " + name : got;
  }

  function refuse(message, reason) {
    if (!checksMockValues && isAnyModuleMocked()) return;
    if (refusal === undefined)
      refusal =
        message +
        " (bun --aot: https://bun.com/docs/bundler/executables#ahead-of-time-compilation)" +
        (reason !== undefined ? "\n  " + reason : "");
  }

  function report(file, step, kind, type, value, action) {
    if (isEnforcing) {
      if (action !== "would-throw" || kind === "as-refuse") return;
      if (logs && refusal === undefined && (checksMockValues || !isAnyModuleMocked()))
        log(file, step, kind, type, value, "threw");
      if (kind === "array-not-plain" && isArray(value) && !isProxy(value) && value[iterator] !== arrayIterator)
        return refuse(
          "Cannot iterate over the array: it has its own Symbol.iterator method, which is not called where the declared type is an array, a tuple or a typed array",
        );
      if (kind === "array-not-plain")
        return refuse(
          "Cannot read array element: the array or its prototype chain has accessors or a Proxy, which are not run for an array of a declared element type",
        );
      if (step.what === "NonNull")
        return refuse(
          "non-null assertion failed: " +
            (step.text !== undefined ? "`" + step.text + "`" : "value") +
            " is " +
            shown(value, type),
        );
      return refuse("expected " + type.t + ", got " + shown(value, type), reasonOf(type, value, "", 0));
    }
    log(file, step, kind, type, value, action);
  }

  function log(file, step, kind, type, value, action) {
    const got = classOf(value, type);
    const id = kind === step.otherKind ? step.otherId : step.id;
    const count = (apply(mapGet, counts, [id + " " + got]) ?? 0) + 1;
    apply(mapSet, counts, [id + " " + got, count]);
    let power = count;
    while (power % 10 === 0) power /= 10;
    if (power !== 1) return;
    const from = callers(),
      reason = action === "would-throw" || action === "threw" ? reasonOf(type, value, "", 0) : undefined;
    if (isJSON) return writeJSON(id, kind, file, step, step.on, type, got, action, count, from, reason);
    write(
      "[aot] type-error " +
        id +
        " " +
        kind +
        " " +
        file +
        ":" +
        step.line +
        ":" +
        step.col +
        " (" +
        step.fn +
        "): " +
        (step.on !== undefined ? "on " + step.on + "; " : "") +
        "expected " +
        type.t +
        ", got " +
        got +
        "; " +
        action +
        "; count " +
        count +
        (reason !== undefined ? "; reason " + reason : "") +
        (step.callId !== undefined ? "; call " + step.callId : "") +
        (from ? "; from " + from : ""),
    );
  }

  function writeJSON(id, kind, file, step, on, type, got, action, count, from, reason) {
    let line =
      '{"aot":"type-error","id":"' +
      id +
      '","kind":"' +
      kind +
      '","what":' +
      stringify(step.what) +
      ',"file":' +
      stringify(file) +
      ',"line":' +
      step.line +
      ',"col":' +
      step.col +
      ',"fn":' +
      stringify(step.fn);
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
      const key = taggedShapeKey(maker);
      return key !== undefined ? shapeBy(key) : null;
    }
    if (isProxy(object)) return null;
    for (let prototype = getPrototypeOf(object); prototype !== null; prototype = getPrototypeOf(prototype)) {
      if (isProxy(prototype)) return null;
      const made = tagOf(prototype);
      if (made !== undefined && made < ENTERED && groupOf(made).parameter)
        return groupOf(made).steps[0].shape !== undefined ? shapeBy(groupOf(made).steps[0].shape) : null;
      const constructor = getOwnPropertyDescriptor(prototype, "constructor")?.value;
      if (typeof constructor !== "function" || getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype)
        return null;
    }
    return null;
  }

  function changeRejection(object, change, name, given, value) {
    const shape = shapeOf(object);
    if (shape === null || shape === undefined) return;
    if (change === 3)
      return shape.record && (value === null || value === ObjectPrototype || shape.otherPrototype)
        ? undefined
        : "Cannot set prototype of " + shape.name + ": objects of a declared type keep their prototype";
    if (change === 2)
      return shape.frozen
        ? undefined
        : "Cannot freeze, seal or prevent extensions of " +
            shape.name +
            ": no TypeScript code of the program passes a value to Object.freeze, Object.seal or Object.preventExtensions as this type, so its objects cannot be frozen";
    const field = hasOwn(shape.fields, name) ? shape.fields[name] : undefined,
      current = getOwnPropertyDescriptor(object, name);
    const ofStore = () =>
      field === undefined ||
      (field.also !== undefined && fits(field.also, value)) ||
      fits(field.to, value) ||
      (field.optional && value === undefined)
        ? undefined
        : (change === 5 ? "" : "Cannot assign to '" + name + "' of " + shape.name + ": ") +
          "expected " +
          field.to.t +
          ", got " +
          shown(value, field.to);
    if (change >= 4) return ofStore();
    if (change === 0)
      return field === undefined || field.optional || current === undefined || !current.configurable
        ? undefined
        : "Cannot delete property '" + name + "' of " + shape.name + ": only optional properties can be deleted";
    const isAccessor = (given & 1) !== 0;
    if (field === undefined) {
      const isIndex = toString(name >>> 0) === name && name >>> 0 !== 4294967295;
      const isWritable = (given & 2) !== 0 ? (given & 4) !== 0 : current !== undefined;
      return isIndex && isExtensible(object) && (isAccessor || !isWritable)
        ? "Cannot define property '" +
            name +
            "' of " +
            shape.name +
            ": indexed properties of an object of a declared type cannot be accessors or read only"
        : undefined;
    }
    const was =
      current === undefined
        ? 7
        : (current.writable ? 1 : 0) | (current.enumerable ? 2 : 0) | (current.configurable ? 4 : 0);
    const of = (present, value, bit) =>
      ((given & present) !== 0 ? (given & value) !== 0 : current !== undefined && (was & bit) !== 0) ? bit : 0;
    const is = of(2, 4, 1) | of(8, 16, 2) | of(32, 64, 4);
    if (!isAccessor && is === was) return (given & 128) !== 0 ? ofStore() : undefined;
    if (shape.frozen && !isAccessor && ((is & 2) !== 0 || field.optional || field.absent === true))
      return (given & 128) !== 0 ? ofStore() : undefined;
    return (
      "Cannot redefine property '" +
      name +
      "' of " +
      shape.name +
      ": declared properties stay writable, enumerable and configurable data properties"
    );
  }

  if (isEnforcing) setGuard(changeRejection);

  function prototypeShape(object) {
    const made = isProxy(object) ? undefined : tagOf(object);
    return made !== undefined && made < ENTERED && groupOf(made).parameter && groupOf(made).steps[0].shape !== undefined
      ? shapeBy(groupOf(made).steps[0].shape)
      : null;
  }

  function reportRule(file, step, kind, on, type, value) {
    if (isEnforcing) return;
    const got = type === undefined ? "" : classOf(value, type);
    const id = kind === step.otherKind ? step.otherId : step.id;
    const count = (apply(mapGet, counts, [id + " " + on + " " + got]) ?? 0) + 1;
    apply(mapSet, counts, [id + " " + on + " " + got, count]);
    let power = count;
    while (power % 10 === 0) power /= 10;
    if (power !== 1) return;
    const from = callers();
    if (isJSON) return writeJSON(id, kind, file, step, on, type, got, "would-throw", count, from);
    write(
      "[aot] type-error " +
        id +
        " " +
        kind +
        " " +
        file +
        ":" +
        step.line +
        ":" +
        step.col +
        " (" +
        step.fn +
        "): on " +
        on +
        (type === undefined ? "" : "; expected " + type.t + ", got " + got) +
        "; would-throw; count " +
        count +
        (from ? "; from " + from : ""),
    );
  }

  function validate(file, step, object) {
    const shape = shapeOf(object);
    if (shape === null) return;
    const names = keys(shape.fields);
    for (let i = 0; i < names.length; i++) {
      const name = names[i],
        field = shape.fields[name],
        descriptor = getOwnPropertyDescriptor(object, name);
      if (descriptor === undefined) continue;
      const isData = descriptor.get === undefined && descriptor.set === undefined;
      if (
        !isData ||
        !(shape.frozen === true
          ? descriptor.enumerable || field.optional || field.absent === true
          : descriptor.writable && descriptor.enumerable && descriptor.configurable)
      ) {
        if (step.kind === "field-redefine") reportRule(file, step, step.kind, shape.name + "." + name);
      } else if (!fits(field.to, descriptor.value) && !(field.optional && descriptor.value === undefined))
        reportRule(file, step, "field-store-untyped", shape.name + "." + name, field.to, descriptor.value);
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
      if (!fits(field.to, value) && !(field.optional && value === undefined))
        reportRule(file, step, step.kind, top.shape.name + "." + step.name, field.to, value);
      return;
    }
    if (typeof value !== "object" && typeof value !== "function") return;
    if (value === null) return;
    if (step.kind === "made") return tag(value, id, isEnforcing && shapeBy(step.shape) !== null);
    if (step.validates) return validate(file, step, value);
    if (step.receives) {
      const ofPrototype = typeof value === "object" ? prototypeShape(value) : null;
      if (ofPrototype !== null && !hasOwn(value, step.name))
        reportRule(file, step, step.kind, ofPrototype.name + ".prototype");
      const shape = ofPrototype === null ? shapeOf(value) : null;
      receivers[depth++] = { pair: step.pair, shape: shape !== null && hasOwn(shape.fields, step.name) ? shape : null };
      return;
    }
    const shape = shapeOf(value);
    if (shape === null) return;
    if (step.kind === "object-set-prototype")
      return shape.record && (step.toNull || shape.otherPrototype)
        ? undefined
        : reportRule(file, step, step.kind, shape.name);
    const field = hasOwn(shape.fields, step.name) ? shape.fields[step.name] : undefined;
    if (field === undefined) return;
    if (step.kind === "field-delete" && !field.optional)
      reportRule(file, step, step.kind, shape.name + "." + step.name);
  }

  function isReadByIndex(array) {
    if (isPlainArray(array)) return true;
    if (array[iterator] !== arrayIterator) return false;
    const names = ownKeys(array),
      length = array.length;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (typeof name !== "string" || toString(name >>> 0) !== name || name >>> 0 >= length) continue;
      const descriptor = getOwnPropertyDescriptor(array, name);
      if (descriptor !== undefined && (descriptor.get !== undefined || descriptor.set !== undefined)) return false;
    }
    return true;
  }

  function waits(step, value) {
    if (reportsUncertain) return false;
    if (step.unsure !== 2 && (step.unsure !== 1 || (value !== null && value !== undefined))) return false;
    if (!hasReportedPending) {
      hasReportedPending = true;
      write(
        "[aot] note: a file changed: some of its checks are paused until the whole program has been analyzed again in the background",
      );
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
      if (hasInspectedMembers && tagOf(value) === undefined) return;
      for (let i = 0; i < steps.length; i++) if (steps[i].to === undefined) return;
      return 1;
    }
    if (typeof value !== "number") return;
    let least = -2147483648,
      most = 2147483647;
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

  function typeKey(type) {
    let key =
      type.t +
      "|" +
      type.p +
      "|" +
      type.o +
      "|" +
      type.fn +
      (type.i === undefined ? "" : "|" + type.i[0] + ".." + type.i[1]);
    for (let i = 0; i < type.parts.length; i++) {
      const part = type.parts[i];
      key +=
        "|" + part.k + ":" + part.name + ":" + part.view + (part.of === undefined ? "" : "<" + typeKey(part.of) + ">");
    }
    return key;
  }

  function resultKey(id) {
    const group = groupOf(id),
      steps = group.steps;
    if (group.parameter || group.step || group.silent || group.unsure || steps.length === 0) return;
    let key = "";
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (
        step.to === undefined ||
        step.unsure !== undefined ||
        step.after !== undefined ||
        step.what === "IteratorOpen"
      )
        return;
      key +=
        (step.what === "Coerce" ? "as " : step.keeps ? "keeps " : "") +
        typeKey(step.to) +
        (step.result === undefined ? "" : ">" + typeKey(step.result)) +
        ";";
    }
    return key;
  }

  return isEnforcing
    ? function check(value, id, now, requestsKey) {
        if (requestsKey) {
          if (now !== generation) {
            generation = now;
            groups.length = 0;
            apply(mapClear, shapes, []);
          }
          return resultKey(id);
        }
        refusal = undefined;
        hasReturnedValue = false;
        reportsUncertain = true;
        let answer = judge(value, id, now);
        reportsUncertain = false;
        if (refusal !== undefined) {
          const later = waitForWholeProgramAnalysis();
          refusal = handedBack = undefined;
          hasReturnedValue = false;
          answer = judge(value, id, later === undefined ? now : later);
          if (refusal !== undefined) return refusal;
        }
        if (!hasReturnedValue) return answer;
        const list = [handedBack];
        handedBack = undefined;
        return list;
      }
    : judge;

  function judge(value, id, now) {
    if (now !== generation) {
      generation = now;
      groups.length = 0;
      apply(mapClear, shapes, []);
    }
    const group = groupOf(id),
      steps = group.steps,
      file = group.file;
    hasInspectedMembers = false;
    inspectedCount = 0;
    if (group.silent || steps.length === 0) return 4;
    if (isEnforcing && !group.parameter) {
      let holds = false;
      for (let i = 0; i < steps.length; i++) if (steps[i].to !== undefined || steps[i].kind === "made") holds = true;
      if (!holds) return 4;
    }
    if (steps.length === 1 && steps[0].kind === "made" && steps[0].unsure === undefined)
      return isEnforcing && shapeBy(steps[0].shape) !== null ? 6 : 3;
    if (group.parameter) {
      const step = steps[0],
        type = step.to;
      if (step.kind === "class-made") {
        tag(getOwnPropertyDescriptor(value, "prototype")?.value, id);
        if (!isEnforcing) return;
        if (step.shape !== undefined && shapeBy(step.shape) !== null) guardInstancesOf(value);
        return fixClassPrototype(value, step.replaceable, step.constructorMayBeReplaced);
      }
      if (fits(type, value)) return passed(group, value, id);
      if (step.second) return isEnforcing ? 5 : undefined;
      if (
        (typeof value === "object" || typeof value === "function") &&
        (type.o || type.fn || type.parts.length) &&
        !step.holds
      )
        return;
      if (castResultFor(type, value) !== undefined) return;
      if (waits(step, value)) return;
      if (hasLast && is(lastValue, value) && lastType === type.t) {
        hasLast = false;
        const from = callers();
        if (from === lastPlace || apply(stringStartsWith, from, [lastPlace + " "])) return;
      }
      report(file, step, step.kind, type, value, "would-throw");
      return;
    }
    let held = value,
      hasFailed = false;
    if (group.step) held = typeof value === "bigint" ? value + toBigInt(group.step) : value + group.step;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i],
        type = step.to;
      if (type === undefined) {
        if (step.unsure === undefined && (!isEnforcing || step.kind === "made")) rule(file, step, value, id);
        continue;
      }
      if (step.what === "IteratorOpen") {
        if (held === null || held === undefined || (typeof held !== "object" && fits(type, held))) continue;
        if (!isArray(held) || isProxy(held) || !isReadByIndex(held)) {
          report(file, step, step.kind, type, held, "would-throw");
          hasFailed = true;
        }
        continue;
      }
      if (
        step.what === "Coerce" &&
        (typeof held === "object" ? held !== null : typeof held === "function") &&
        (type.o || type.fn || type.parts.length !== 0)
      )
        continue;
      if (fits(type, held)) continue;
      if (
        step.keeps &&
        held !== null &&
        (typeof held === "object" || typeof held === "function") &&
        acceptsOtherLayouts(type)
      )
        continue;
      if (waits(step, held)) return;
      if (step.after !== undefined) {
        for (let j = 0; j < step.after.length; j++) if (apply(mapGet, converted, [file + ":" + step.after[j]])) return;
      }
      if (step.what !== "Coerce") {
        const made = castResultFor(type, held);
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
      if (isEnforcing) {
        handedBack = held = result;
        hasReturnedValue = hasFailed = true;
        continue;
      }
      apply(mapSet, converted, [file + ":" + step.line + ":" + step.col, true]);
      const results = castResultCount > 4096 ? null : apply(mapGet, castResults, [held]);
      if (results === undefined) {
        apply(mapSet, castResults, [held, [result]]);
        if (++castResultCount > 4096) {
          apply(mapClear, castResults, []);
          write(
            "[aot] note: `as` has converted more than 4096 different values: from here on, a string, number or boolean that fails a check is not reported if a conversion would make it pass",
          );
        }
      } else if (results !== null && castResultFor(type, held) === undefined) results[results.length] = result;
      held = result;
      hasFailed = true;
    }
    if (!hasFailed) return passed(group, value, id);
  }
});
