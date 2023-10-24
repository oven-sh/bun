(function (){"use strict";// build2/tmp/internal/util/inspect.ts
var vmSafeInstanceof = function(val, ctor) {
  if (val instanceof ctor)
    return true;
  while (val) {
    if (typeof val !== "object")
      return false;
    if (ctor.name === internalGetConstructorName(val))
      return true;
    val = ObjectGetPrototypeOf(val);
  }
  return false;
};
var checkBox = function(ctor) {
  return (val) => {
    if (!vmSafeInstanceof(val, ctor))
      return false;
    try {
      ctor.prototype.valueOf.@call(val);
    } catch {
      return false;
    }
    return true;
  };
};
var assert = function(p, message) {
  if (!p)
    throw new AssertionError(message);
};
var getUserOptions = function(ctx, isCrossContext) {
  const ret = {
    stylize: ctx.stylize,
    showHidden: ctx.showHidden,
    depth: ctx.depth,
    colors: ctx.colors,
    customInspect: ctx.customInspect,
    showProxy: ctx.showProxy,
    maxArrayLength: ctx.maxArrayLength,
    maxStringLength: ctx.maxStringLength,
    breakLength: ctx.breakLength,
    compact: ctx.compact,
    sorted: ctx.sorted,
    getters: ctx.getters,
    numericSeparator: ctx.numericSeparator,
    ...ctx.userOptions
  };
  if (isCrossContext) {
    ObjectSetPrototypeOf(ret, null);
    for (const key of ObjectKeys(ret)) {
      if ((typeof ret[key] === "object" || typeof ret[key] === "function") && ret[key] !== null) {
        delete ret[key];
      }
    }
    ret.stylize = ObjectSetPrototypeOf((value, flavour) => {
      let stylized;
      try {
        stylized = `${ctx.stylize(value, flavour)}`;
      } catch {
      }
      if (typeof stylized !== "string")
        return value;
      return stylized;
    }, null);
  }
  return ret;
};
var inspect = function(value, opts) {
  const ctx = {
    budget: {},
    indentationLvl: 0,
    seen: [],
    currentDepth: 0,
    stylize: stylizeNoColor,
    showHidden: inspectDefaultOptions.showHidden,
    depth: inspectDefaultOptions.depth,
    colors: inspectDefaultOptions.colors,
    customInspect: inspectDefaultOptions.customInspect,
    showProxy: inspectDefaultOptions.showProxy,
    maxArrayLength: inspectDefaultOptions.maxArrayLength,
    maxStringLength: inspectDefaultOptions.maxStringLength,
    breakLength: inspectDefaultOptions.breakLength,
    compact: inspectDefaultOptions.compact,
    sorted: inspectDefaultOptions.sorted,
    getters: inspectDefaultOptions.getters,
    numericSeparator: inspectDefaultOptions.numericSeparator
  };
  if (arguments.length > 1) {
    if (arguments.length > 2) {
      if (arguments[2] !== @undefined) {
        ctx.depth = arguments[2];
      }
      if (arguments.length > 3 && arguments[3] !== @undefined) {
        ctx.colors = arguments[3];
      }
    }
    if (typeof opts === "boolean") {
      ctx.showHidden = opts;
    } else if (opts) {
      const optKeys = ObjectKeys(opts);
      for (let i = 0;i < optKeys.length; ++i) {
        const key = optKeys[i];
        if (ObjectPrototypeHasOwnProperty(inspectDefaultOptions, key) || key === "stylize") {
          ctx[key] = opts[key];
        } else if (ctx.userOptions === @undefined) {
          ctx.userOptions = opts;
        }
      }
    }
  }
  if (ctx.colors)
    ctx.stylize = stylizeWithColor;
  if (ctx.maxArrayLength === null)
    ctx.maxArrayLength = @Infinity;
  if (ctx.maxStringLength === null)
    ctx.maxStringLength = @Infinity;
  return formatValue(ctx, value, 0);
};
var defineColorAlias = function(target, alias) {
  ObjectDefineProperty(inspect.colors, alias, {
    __proto__: null,
    get() {
      return this[target];
    },
    set(value) {
      this[target] = value;
    },
    configurable: true,
    enumerable: false
  });
};
var addQuotes = function(str, quotes) {
  if (quotes === -1)
    return `"${str}"`;
  if (quotes === -2)
    return `\`${str}\``;
  return `'${str}'`;
};
var escapeFn = function(str) {
  const charCode = StringPrototypeCharCodeAt(str);
  return meta.length > charCode ? meta[charCode] : `\\u${NumberPrototypeToString(charCode, 16)}`;
};
var strEscape = function(str) {
  let escapeTest = strEscapeSequencesRegExp;
  let escapeReplace = strEscapeSequencesReplacer;
  let singleQuote = 39;
  if (StringPrototypeIncludes(str, "'")) {
    if (!StringPrototypeIncludes(str, '"')) {
      singleQuote = -1;
    } else if (!StringPrototypeIncludes(str, "`") && !StringPrototypeIncludes(str, "${")) {
      singleQuote = -2;
    }
    if (singleQuote !== 39) {
      escapeTest = strEscapeSequencesRegExpSingle;
      escapeReplace = strEscapeSequencesReplacerSingle;
    }
  }
  if (str.length < 5000 && RegExpPrototypeExec(escapeTest, str) === null)
    return addQuotes(str, singleQuote);
  if (str.length > 100) {
    str = RegExpPrototypeSymbolReplace(escapeReplace, str, escapeFn);
    return addQuotes(str, singleQuote);
  }
  let result = "";
  let last = 0;
  for (let i = 0;i < str.length; i++) {
    const point = StringPrototypeCharCodeAt(str, i);
    if (point === singleQuote || point === 92 || point < 32 || point > 126 && point < 160) {
      if (last === i) {
        result += meta[point];
      } else {
        result += `${StringPrototypeSlice(str, last, i)}${meta[point]}`;
      }
      last = i + 1;
    } else if (point >= 55296 && point <= 57343) {
      if (point <= 56319 && i + 1 < str.length) {
        const point2 = StringPrototypeCharCodeAt(str, i + 1);
        if (point2 >= 56320 && point2 <= 57343) {
          i++;
          continue;
        }
      }
      result += `${StringPrototypeSlice(str, last, i)}\\u${NumberPrototypeToString(point, 16)}`;
      last = i + 1;
    }
  }
  if (last !== str.length) {
    result += StringPrototypeSlice(str, last);
  }
  return addQuotes(result, singleQuote);
};
var stylizeWithColor = function(str, styleType) {
  const style = inspect.styles[styleType];
  if (style !== @undefined) {
    const color = inspect.colors[style];
    if (color !== @undefined)
      return `\x1B[${color[0]}m${str}\x1B[${color[1]}m`;
  }
  return str;
};
var stylizeNoColor = function(str) {
  return str;
};
var getEmptyFormatArray = function() {
  return [];
};
var isInstanceof = function(object, proto) {
  try {
    return object instanceof proto;
  } catch {
    return false;
  }
};
var getConstructorName = function(obj, ctx, recurseTimes, protoProps) {
  let firstProto;
  const tmp = obj;
  while (obj || isUndetectableObject(obj)) {
    const descriptor = ObjectGetOwnPropertyDescriptor(obj, "constructor");
    if (descriptor !== @undefined && typeof descriptor.value === "function" && descriptor.value.name !== "" && isInstanceof(tmp, descriptor.value)) {
      if (protoProps !== @undefined && (firstProto !== obj || !builtInObjects.has(descriptor.value.name))) {
        addPrototypeProperties(ctx, tmp, firstProto || tmp, recurseTimes, protoProps);
      }
      return String(descriptor.value.name);
    }
    obj = ObjectGetPrototypeOf(obj);
    if (firstProto === @undefined) {
      firstProto = obj;
    }
  }
  if (firstProto === null) {
    return null;
  }
  const res = internalGetConstructorName(tmp);
  if (recurseTimes > ctx.depth && ctx.depth !== null) {
    return `${res} <Complex prototype>`;
  }
  const protoConstr = getConstructorName(firstProto, ctx, recurseTimes + 1, protoProps);
  if (protoConstr === null) {
    return `${res} <${inspect(firstProto, {
      ...ctx,
      customInspect: false,
      depth: -1
    })}>`;
  }
  return `${res} <${protoConstr}>`;
};
var addPrototypeProperties = function(ctx, main, obj, recurseTimes, output) {
  let depth = 0;
  let keys;
  let keySet;
  do {
    if (depth !== 0 || main === obj) {
      obj = ObjectGetPrototypeOf(obj);
      if (obj === null) {
        return;
      }
      const descriptor = ObjectGetOwnPropertyDescriptor(obj, "constructor");
      if (descriptor !== @undefined && typeof descriptor.value === "function" && builtInObjects.has(descriptor.value.name)) {
        return;
      }
    }
    if (depth === 0) {
      keySet = new SafeSet;
    } else {
      ArrayPrototypeForEach(keys, (key) => keySet.add(key));
    }
    keys = ReflectOwnKeys(obj);
    ArrayPrototypePush(ctx.seen, main);
    for (const key of keys) {
      if (key === "constructor" || ObjectPrototypeHasOwnProperty(main, key) || depth !== 0 && keySet.has(key)) {
        continue;
      }
      const desc = ObjectGetOwnPropertyDescriptor(obj, key);
      if (typeof desc.value === "function") {
        continue;
      }
      const value = formatProperty(ctx, obj, recurseTimes, key, kObjectType, desc, main);
      if (ctx.colors) {
        ArrayPrototypePush(output, `\x1B[2m${value}\x1B[22m`);
      } else {
        ArrayPrototypePush(output, value);
      }
    }
    ArrayPrototypePop(ctx.seen);
  } while (++depth !== 3);
};
var getPrefix = function(constructor, tag, fallback, size = "") {
  if (constructor === null) {
    if (tag !== "" && fallback !== tag) {
      return `[${fallback}${size}: null prototype] [${tag}] `;
    }
    return `[${fallback}${size}: null prototype] `;
  }
  if (tag !== "" && constructor !== tag) {
    return `${constructor}${size} [${tag}] `;
  }
  return `${constructor}${size} `;
};
var getKeys = function(value, showHidden) {
  let keys;
  const symbols = ObjectGetOwnPropertySymbols(value);
  if (showHidden) {
    keys = ObjectGetOwnPropertyNames(value);
    if (symbols.length !== 0)
      ArrayPrototypePushApply(keys, symbols);
  } else {
    try {
      keys = ObjectKeys(value);
    } catch (err) {
      assert(isNativeError(err) && err.name === "ReferenceError" && isModuleNamespaceObject(value));
      keys = ObjectGetOwnPropertyNames(value);
    }
    if (symbols.length !== 0) {
      const filter = (key) => ObjectPrototypePropertyIsEnumerable(value, key);
      ArrayPrototypePushApply(keys, ArrayPrototypeFilter(symbols, filter));
    }
  }
  return keys;
};
var getCtxStyle = function(value, constructor, tag) {
  let fallback = "";
  if (constructor === null) {
    fallback = internalGetConstructorName(value);
    if (fallback === tag) {
      fallback = "Object";
    }
  }
  return getPrefix(constructor, tag, fallback);
};
var formatProxy = function(ctx, proxy, recurseTimes) {
  if (recurseTimes > ctx.depth && ctx.depth !== null) {
    return ctx.stylize("Proxy [Array]", "special");
  }
  recurseTimes += 1;
  ctx.indentationLvl += 2;
  const res = [formatValue(ctx, proxy[0], recurseTimes), formatValue(ctx, proxy[1], recurseTimes)];
  ctx.indentationLvl -= 2;
  return reduceToSingleString(ctx, res, "", ["Proxy [", "]"], kArrayExtrasType, recurseTimes);
};
var formatValue = function(ctx, value, recurseTimes, typedArray) {
  if (typeof value !== "object" && typeof value !== "function" && !isUndetectableObject(value)) {
    return formatPrimitive(ctx.stylize, value, ctx);
  }
  if (value === null) {
    return ctx.stylize("null", "null");
  }
  const context = value;
  const proxy = getProxyDetails(value, !!ctx.showProxy);
  if (proxy !== @undefined) {
    if (proxy === null || proxy[0] === null) {
      return ctx.stylize("<Revoked Proxy>", "special");
    }
    if (ctx.showProxy) {
      return formatProxy(ctx, proxy, recurseTimes);
    }
    value = proxy;
  }
  if (ctx.customInspect) {
    const maybeCustom = value[customInspectSymbol];
    if (typeof maybeCustom === "function" && maybeCustom !== inspect && !(value.constructor && value.constructor.prototype === value)) {
      const depth = ctx.depth === null ? null : ctx.depth - recurseTimes;
      const isCrossContext = proxy !== @undefined || !(context instanceof Object);
      const ret = maybeCustom.@call(context, depth, getUserOptions(ctx, isCrossContext), inspect);
      if (ret !== context) {
        if (typeof ret !== "string")
          return formatValue(ctx, ret, recurseTimes);
        return StringPrototypeReplaceAll(ret, "\n", `\n${StringPrototypeRepeat(" ", ctx.indentationLvl)}`);
      }
    }
  }
  if (ctx.seen.includes(value)) {
    let index = 1;
    if (ctx.circular === @undefined) {
      ctx.circular = new SafeMap;
      ctx.circular.set(value, index);
    } else {
      index = ctx.circular.get(value);
      if (index === @undefined) {
        index = ctx.circular.size + 1;
        ctx.circular.set(value, index);
      }
    }
    return ctx.stylize(`[Circular *${index}]`, "special");
  }
  return formatRaw(ctx, value, recurseTimes, typedArray);
};
var formatRaw = function(ctx, value, recurseTimes, typedArray) {
  let keys;
  let protoProps;
  if (ctx.showHidden && (recurseTimes <= ctx.depth || ctx.depth === null)) {
    protoProps = [];
  }
  const constructor = getConstructorName(value, ctx, recurseTimes, protoProps);
  if (protoProps !== @undefined && protoProps.length === 0) {
    protoProps = @undefined;
  }
  let tag = value[SymbolToStringTag];
  if (typeof tag !== "string" || tag !== "" && (ctx.showHidden ? ObjectPrototypeHasOwnProperty : ObjectPrototypePropertyIsEnumerable)(value, SymbolToStringTag)) {
    tag = "";
  }
  let base = "";
  let formatter = getEmptyFormatArray;
  let braces;
  let noIterator = true;
  let i = 0;
  const filter = ctx.showHidden ? ALL_PROPERTIES : ONLY_ENUMERABLE;
  let extrasType = kObjectType;
  if ((SymbolIterator in value) || constructor === null) {
    noIterator = false;
    if (ArrayIsArray(value)) {
      const prefix = constructor !== "Array" || tag !== "" ? getPrefix(constructor, tag, "Array", `(${value.length})`) : "";
      keys = getOwnNonIndexProperties(value, filter);
      braces = [`${prefix}[`, "]"];
      if (value.length === 0 && keys.length === 0 && protoProps === @undefined)
        return `${braces[0]}]`;
      extrasType = kArrayExtrasType;
      formatter = formatArray;
    } else if (isSet(value)) {
      const size = SetPrototypeGetSize(value);
      const prefix = getPrefix(constructor, tag, "Set", `(${size})`);
      keys = getKeys(value, ctx.showHidden);
      formatter = constructor !== null ? FunctionPrototypeBind(formatSet, null, value) : FunctionPrototypeBind(formatSet, null, SetPrototypeValues(value));
      if (size === 0 && keys.length === 0 && protoProps === @undefined)
        return `${prefix}{}`;
      braces = [`${prefix}{`, "}"];
    } else if (isMap(value)) {
      const size = MapPrototypeGetSize(value);
      const prefix = getPrefix(constructor, tag, "Map", `(${size})`);
      keys = getKeys(value, ctx.showHidden);
      formatter = constructor !== null ? FunctionPrototypeBind(formatMap, null, value) : FunctionPrototypeBind(formatMap, null, MapPrototypeEntries(value));
      if (size === 0 && keys.length === 0 && protoProps === @undefined)
        return `${prefix}{}`;
      braces = [`${prefix}{`, "}"];
    } else if (isTypedArray(value)) {
      keys = getOwnNonIndexProperties(value, filter);
      let bound = value;
      let fallback = "";
      if (constructor === null) {
        fallback = TypedArrayPrototypeGetSymbolToStringTag(value);
        bound = new primordials[fallback](value);
      }
      const size = TypedArrayPrototypeGetLength(value);
      const prefix = getPrefix(constructor, tag, fallback, `(${size})`);
      braces = [`${prefix}[`, "]"];
      if (value.length === 0 && keys.length === 0 && !ctx.showHidden)
        return `${braces[0]}]`;
      formatter = FunctionPrototypeBind(formatTypedArray, null, bound, size);
      extrasType = kArrayExtrasType;
    } else if (isMapIterator(value)) {
      keys = getKeys(value, ctx.showHidden);
      braces = getIteratorBraces("Map", tag);
      formatter = FunctionPrototypeBind(formatIterator, null, braces);
    } else if (isSetIterator(value)) {
      keys = getKeys(value, ctx.showHidden);
      braces = getIteratorBraces("Set", tag);
      formatter = FunctionPrototypeBind(formatIterator, null, braces);
    } else {
      noIterator = true;
    }
  }
  if (noIterator) {
    keys = getKeys(value, ctx.showHidden);
    braces = ["{", "}"];
    if (constructor === "Object") {
      if (isArgumentsObject(value)) {
        braces[0] = "[Arguments] {";
      } else if (tag !== "") {
        braces[0] = `${getPrefix(constructor, tag, "Object")}{`;
      }
      if (keys.length === 0 && protoProps === @undefined) {
        return `${braces[0]}}`;
      }
    } else if (typeof value === "function") {
      base = getFunctionBase(value, constructor, tag);
      if (keys.length === 0 && protoProps === @undefined)
        return ctx.stylize(base, "special");
    } else if (isRegExp(value)) {
      base = RegExpPrototypeToString(constructor !== null ? value : new RegExp(value));
      const prefix = getPrefix(constructor, tag, "RegExp");
      if (prefix !== "RegExp ")
        base = `${prefix}${base}`;
      if (keys.length === 0 && protoProps === @undefined || recurseTimes > ctx.depth && ctx.depth !== null) {
        return ctx.stylize(base, "regexp");
      }
    } else if (isDate(value)) {
      base = NumberIsNaN(DatePrototypeGetTime(value)) ? DatePrototypeToString(value) : DatePrototypeToISOString(value);
      const prefix = getPrefix(constructor, tag, "Date");
      if (prefix !== "Date ")
        base = `${prefix}${base}`;
      if (keys.length === 0 && protoProps === @undefined) {
        return ctx.stylize(base, "date");
      }
    } else if (value instanceof Error) {
      base = formatError(value, constructor, tag, ctx, keys);
      if (keys.length === 0 && protoProps === @undefined)
        return base;
    } else if (isAnyArrayBuffer(value)) {
      const arrayType = isArrayBuffer(value) ? "ArrayBuffer" : "SharedArrayBuffer";
      const prefix = getPrefix(constructor, tag, arrayType);
      if (typedArray === @undefined) {
        formatter = formatArrayBuffer;
      } else if (keys.length === 0 && protoProps === @undefined) {
        return prefix + `{ byteLength: ${formatNumber(ctx.stylize, value.byteLength, false)} }`;
      }
      braces[0] = `${prefix}{`;
      ArrayPrototypeUnshift(keys, "byteLength");
    } else if (isDataView(value)) {
      braces[0] = `${getPrefix(constructor, tag, "DataView")}{`;
      ArrayPrototypeUnshift(keys, "byteLength", "byteOffset", "buffer");
    } else if (isPromise(value)) {
      braces[0] = `${getPrefix(constructor, tag, "Promise")}{`;
      formatter = formatPromise;
    } else if (isWeakSet(value)) {
      braces[0] = `${getPrefix(constructor, tag, "WeakSet")}{`;
      formatter = ctx.showHidden ? formatWeakSet : formatWeakCollection;
    } else if (isWeakMap(value)) {
      braces[0] = `${getPrefix(constructor, tag, "WeakMap")}{`;
      formatter = ctx.showHidden ? formatWeakMap : formatWeakCollection;
    } else if (isModuleNamespaceObject(value)) {
      braces[0] = `${getPrefix(constructor, tag, "Module")}{`;
      formatter = formatNamespaceObject.bind(null, keys);
    } else if (isBoxedPrimitive(value)) {
      base = getBoxedBase(value, ctx, keys, constructor, tag);
      if (keys.length === 0 && protoProps === @undefined) {
        return base;
      }
    } else {
      if (keys.length === 0 && protoProps === @undefined) {
        if (isExternal(value)) {
          const address = "0";
          return ctx.stylize(`[External: ${address}]`, "special");
        }
        return `${getCtxStyle(value, constructor, tag)}{}`;
      }
      braces[0] = `${getCtxStyle(value, constructor, tag)}{`;
    }
  }
  if (recurseTimes > ctx.depth && ctx.depth !== null) {
    let constructorName = StringPrototypeSlice(getCtxStyle(value, constructor, tag), 0, -1);
    if (constructor !== null)
      constructorName = `[${constructorName}]`;
    return ctx.stylize(constructorName, "special");
  }
  recurseTimes += 1;
  ctx.seen.push(value);
  ctx.currentDepth = recurseTimes;
  let output;
  const indentationLvl = ctx.indentationLvl;
  try {
    if (ctx.currentDepth > 1000)
      @throwRangeError(ERROR_STACK_OVERFLOW_MSG);
    output = formatter(ctx, value, recurseTimes);
    for (i = 0;i < keys.length; i++) {
      ArrayPrototypePush(output, formatProperty(ctx, value, recurseTimes, keys[i], extrasType));
    }
    if (protoProps !== @undefined) {
      ArrayPrototypePushApply(output, protoProps);
    }
  } catch (err) {
    if (err instanceof RangeError && err.message === ERROR_STACK_OVERFLOW_MSG) {
      const constructorName = StringPrototypeSlice(getCtxStyle(value, constructor, tag), 0, -1);
      ctx.seen.pop();
      ctx.indentationLvl = indentationLvl;
      return ctx.stylize(`[${constructorName}: Inspection interrupted prematurely. Maximum call stack size exceeded.]`, "special");
    }
    throw new AssertionError("handleMaxCallStackSize assertion failed: " + String(err), true);
  }
  if (ctx.circular !== @undefined) {
    const index = ctx.circular.get(value);
    if (index !== @undefined) {
      ctx.seenRefs ??= new Set;
      const SEEN = ctx.seenRefs.has(index);
      if (!SEEN) {
        ctx.seenRefs.add(index);
        const reference = ctx.stylize(`<ref *${index}>`, "special");
        if (ctx.compact !== true) {
          base = base === "" ? reference : `${reference} ${base}`;
        } else {
          braces[0] = `${reference} ${braces[0]}`;
        }
      } else {
        //! this is a non-standard behavior compared to Node's implementation
        const reference = ctx.stylize(`[Circular *${index}]`, "special");
        return reference;
      }
    }
  }
  ctx.seen.pop();
  if (ctx.sorted) {
    const comparator = ctx.sorted === true ? @undefined : ctx.sorted;
    if (extrasType === kObjectType) {
      ArrayPrototypeSort(output, comparator);
    } else if (keys.length > 1) {
      const sorted = ArrayPrototypeSort(ArrayPrototypeSlice(output, output.length - keys.length), comparator);
      ArrayPrototypeUnshift(sorted, output, output.length - keys.length, keys.length);
      ReflectApply(ArrayPrototypeSplice, null, sorted);
    }
  }
  const res = reduceToSingleString(ctx, output, base, braces, extrasType, recurseTimes, value);
  const budget = ctx.budget[ctx.indentationLvl] || 0;
  const newLength = budget + res.length;
  ctx.budget[ctx.indentationLvl] = newLength;
  if (newLength > 134217728) {
    ctx.depth = -1;
  }
  return res;
};
var getIteratorBraces = function(type, tag) {
  if (tag !== `${type} Iterator`) {
    if (tag !== "")
      tag += "] [";
    tag += `${type} Iterator`;
  }
  return [`[${tag}] {`, "}"];
};
var getBoxedBase = function(value, ctx, keys, constructor, tag) {
  let fn;
  let type;
  if (isNumberObject(value)) {
    fn = NumberPrototypeValueOf;
    type = "Number";
  } else if (isStringObject(value)) {
    fn = StringPrototypeValueOf;
    type = "String";
    keys.splice(0, value.length);
  } else if (isBooleanObject(value)) {
    fn = BooleanPrototypeValueOf;
    type = "Boolean";
  } else if (isBigIntObject(value)) {
    fn = BigIntPrototypeValueOf;
    type = "BigInt";
  } else {
    fn = SymbolPrototypeValueOf;
    type = "Symbol";
  }
  let base = `[${type}`;
  if (type !== constructor) {
    if (constructor === null) {
      base += " (null prototype)";
    } else {
      base += ` (${constructor})`;
    }
  }
  base += `: ${formatPrimitive(stylizeNoColor, fn(value), ctx)}]`;
  if (tag !== "" && tag !== constructor) {
    base += ` [${tag}]`;
  }
  if (keys.length !== 0 || ctx.stylize === stylizeNoColor)
    return base;
  return ctx.stylize(base, StringPrototypeToLowerCase(type));
};
var getClassBase = function(value, constructor, tag) {
  const hasName = ObjectPrototypeHasOwnProperty(value, "name");
  const name = hasName && value.name || "(anonymous)";
  let base = `class ${name}`;
  if (constructor !== "Function" && constructor !== null) {
    base += ` [${constructor}]`;
  }
  if (tag !== "" && constructor !== tag) {
    base += ` [${tag}]`;
  }
  if (constructor !== null) {
    const superName = ObjectGetPrototypeOf(value).name;
    if (superName) {
      base += ` extends ${superName}`;
    }
  } else {
    base += " extends [null prototype]";
  }
  return `[${base}]`;
};
var getFunctionBase = function(value, constructor, tag) {
  const stringified = FunctionPrototypeToString(value);
  if (StringPrototypeStartsWith(stringified, "class") && StringPrototypeEndsWith(stringified, "}")) {
    const slice = StringPrototypeSlice(stringified, 5, -1);
    const bracketIndex = StringPrototypeIndexOf(slice, "{");
    if (bracketIndex !== -1 && (!StringPrototypeIncludes(StringPrototypeSlice(slice, 0, bracketIndex), "(") || RegExpPrototypeExec(classRegExp, RegExpPrototypeSymbolReplace(stripCommentsRegExp, slice)) !== null)) {
      return getClassBase(value, constructor, tag);
    }
  }
  let type = "Function";
  if (isGeneratorFunction(value)) {
    type = `Generator${type}`;
  }
  if (isAsyncFunction(value)) {
    type = `Async${type}`;
  }
  let base = `[${type}`;
  if (constructor === null) {
    base += " (null prototype)";
  }
  if (value.name === "") {
    base += " (anonymous)";
  } else {
    base += `: ${value.name}`;
  }
  base += "]";
  if (constructor !== type && constructor !== null) {
    base += ` ${constructor}`;
  }
  if (tag !== "" && constructor !== tag) {
    base += ` [${tag}]`;
  }
  return base;
};
var identicalSequenceRange = function(a, b) {
  for (let i = 0;i < a.length - 3; i++) {
    const pos = b.indexOf(a[i]);
    if (pos !== -1) {
      const rest = b.length - pos;
      if (rest > 3) {
        let len = 1;
        const maxLen = MathMin(a.length - i, rest);
        while (maxLen > len && a[i + len] === b[pos + len]) {
          len++;
        }
        if (len > 3) {
          return { len, offset: i };
        }
      }
    }
  }
  return { len: 0, offset: 0 };
};
var getStackString = function(error) {
  return error.stack ? String(error.stack) : ErrorPrototypeToString(error);
};
var getStackFrames = function(ctx, err, stack) {
  const frames = StringPrototypeSplit(stack, "\n");
  let cause;
  try {
    ({ cause } = err);
  } catch {
  }
  if (cause != null && cause instanceof Error) {
    const causeStack = getStackString(cause);
    const causeStackStart = StringPrototypeIndexOf(causeStack, "\n    at");
    if (causeStackStart !== -1) {
      const causeFrames = StringPrototypeSplit(StringPrototypeSlice(causeStack, causeStackStart + 1), "\n");
      const { len, offset } = identicalSequenceRange(frames, causeFrames);
      if (len > 0) {
        const skipped = len - 2;
        const msg = `    ... ${skipped} lines matching cause stack trace ...`;
        frames.splice(offset + 1, skipped, ctx.stylize(msg, "undefined"));
      }
    }
  }
  return frames;
};
var improveStack = function(stack, constructor, name, tag) {
  let len = name.length;
  if (constructor === null || StringPrototypeEndsWith(name, "Error") && StringPrototypeStartsWith(stack, name) && (stack.length === len || stack[len] === ":" || stack[len] === "\n")) {
    let fallback = "Error";
    if (constructor === null) {
      const start = RegExpPrototypeExec(/^([A-Z][a-z_ A-Z0-9[\]()-]+)(?::|\n {4}at)/, stack) || RegExpPrototypeExec(/^([a-z_A-Z0-9-]*Error)$/, stack);
      fallback = start && start[1] || "";
      len = fallback.length;
      fallback = fallback || "Error";
    }
    const prefix = StringPrototypeSlice(getPrefix(constructor, tag, fallback), 0, -1);
    if (name !== prefix) {
      if (StringPrototypeIncludes(prefix, name)) {
        if (len === 0) {
          stack = `${prefix}: ${stack}`;
        } else {
          stack = `${prefix}${StringPrototypeSlice(stack, len)}`;
        }
      } else {
        stack = `${prefix} [${name}]${StringPrototypeSlice(stack, len)}`;
      }
    }
  }
  return stack;
};
var removeDuplicateErrorKeys = function(ctx, keys, err, stack) {
  if (!ctx.showHidden && keys.length !== 0) {
    for (const name of ["name", "message", "stack"]) {
      const index = ArrayPrototypeIndexOf(keys, name);
      if (index !== -1 && StringPrototypeIncludes(stack, err[name])) {
        ArrayPrototypeSplice(keys, index, 1);
      }
    }
  }
};
var markNodeModules = function(ctx, line) {
  let tempLine = "";
  let nodeModule;
  let pos = 0;
  while ((nodeModule = nodeModulesRegExp.exec(line)) !== null) {
    tempLine += StringPrototypeSlice(line, pos, nodeModule.index + 14);
    tempLine += ctx.stylize(nodeModule[1], "module");
    pos = nodeModule.index + nodeModule[0].length;
  }
  if (pos !== 0) {
    line = tempLine + StringPrototypeSlice(line, pos);
  }
  return line;
};
var markCwd = function(ctx, line, workingDirectory) {
  let cwdStartPos = StringPrototypeIndexOf(line, workingDirectory);
  let tempLine = "";
  let cwdLength = workingDirectory.length;
  if (cwdStartPos !== -1) {
    if (StringPrototypeSlice(line, cwdStartPos - 7, cwdStartPos) === "file://") {
      cwdLength += 7;
      cwdStartPos -= 7;
    }
    const start = line[cwdStartPos - 1] === "(" ? cwdStartPos - 1 : cwdStartPos;
    const end = start !== cwdStartPos && StringPrototypeEndsWith(line, ")") ? -1 : line.length;
    const workingDirectoryEndPos = cwdStartPos + cwdLength + 1;
    const cwdSlice = StringPrototypeSlice(line, start, workingDirectoryEndPos);
    tempLine += StringPrototypeSlice(line, 0, start);
    tempLine += ctx.stylize(cwdSlice, "undefined");
    tempLine += StringPrototypeSlice(line, workingDirectoryEndPos, end);
    if (end === -1) {
      tempLine += ctx.stylize(")", "undefined");
    }
  } else {
    tempLine += line;
  }
  return tempLine;
};
var safeGetCWD = function() {
  let workingDirectory;
  try {
    workingDirectory = process.cwd();
  } catch {
    return;
  }
  return workingDirectory;
};
var formatError = function(err, constructor, tag, ctx, keys) {
  const name = err.name != null ? String(err.name) : "Error";
  let stack = getStackString(err);
  //! temp fix for Bun losing the error name from inherited errors + extraneous ": " with no message
  stack = stack.replace(/^Error: /, `${name}${err.message ? ": " : ""}`);
  removeDuplicateErrorKeys(ctx, keys, err, stack);
  if (("cause" in err) && (keys.length === 0 || !ArrayPrototypeIncludes(keys, "cause"))) {
    ArrayPrototypePush(keys, "cause");
  }
  if (ArrayIsArray(err.errors) && (keys.length === 0 || !ArrayPrototypeIncludes(keys, "errors"))) {
    ArrayPrototypePush(keys, "errors");
  }
  stack = improveStack(stack, constructor, name, tag);
  let pos = err.message && StringPrototypeIndexOf(stack, err.message) || -1;
  if (pos !== -1)
    pos += err.message.length;
  const stackStart = StringPrototypeIndexOf(stack, "\n    at", pos);
  if (stackStart === -1) {
    stack = `[${stack}]`;
  } else {
    let newStack = StringPrototypeSlice(stack, 0, stackStart);
    const stackFramePart = StringPrototypeSlice(stack, stackStart + 1);
    const lines = getStackFrames(ctx, err, stackFramePart);
    if (ctx.colors) {
      const workingDirectory = safeGetCWD();
      let esmWorkingDirectory;
      for (let line of lines) {
        const core = RegExpPrototypeExec(coreModuleRegExp, line);
        if (core !== null && (StringPrototypeStartsWith(core[1], "internal/") || ArrayPrototypeIncludes(@requireNativeModule("module").builtinModules, core[1]))) {
          newStack += `\n${ctx.stylize(line, "undefined")}`;
        } else {
          newStack += "\n";
          line = markNodeModules(ctx, line);
          if (workingDirectory !== @undefined) {
            let newLine = markCwd(ctx, line, workingDirectory);
            if (newLine === line) {
              esmWorkingDirectory ??= pathToFileURL(workingDirectory);
              newLine = markCwd(ctx, line, esmWorkingDirectory);
            }
            line = newLine;
          }
          newStack += line;
        }
      }
    } else {
      newStack += `\n${ArrayPrototypeJoin(lines, "\n")}`;
    }
    stack = newStack;
  }
  if (ctx.indentationLvl !== 0) {
    const indentation = StringPrototypeRepeat(" ", ctx.indentationLvl);
    stack = StringPrototypeReplaceAll(stack, "\n", `\n${indentation}`);
  }
  return stack;
};
var groupArrayElements = function(ctx, output, value) {
  let totalLength = 0;
  let maxLength = 0;
  let i = 0;
  let outputLength = output.length;
  if (ctx.maxArrayLength < output.length) {
    outputLength--;
  }
  const separatorSpace = 2;
  const dataLen = new Array(outputLength);
  for (;i < outputLength; i++) {
    const len = getStringWidth(output[i], ctx.colors);
    dataLen[i] = len;
    totalLength += len + separatorSpace;
    if (maxLength < len)
      maxLength = len;
  }
  const actualMax = maxLength + separatorSpace;
  if (actualMax * 3 + ctx.indentationLvl < ctx.breakLength && (totalLength / actualMax > 5 || maxLength <= 6)) {
    const approxCharHeights = 2.5;
    const averageBias = MathSqrt(actualMax - totalLength / output.length);
    const biasedMax = MathMax(actualMax - 3 - averageBias, 1);
    const columns = MathMin(MathRound(MathSqrt(approxCharHeights * biasedMax * outputLength) / biasedMax), MathFloor((ctx.breakLength - ctx.indentationLvl) / actualMax), ctx.compact * 4, 15);
    if (columns <= 1) {
      return output;
    }
    const tmp = [];
    const maxLineLength = [];
    for (let i2 = 0;i2 < columns; i2++) {
      let lineMaxLength = 0;
      for (let j = i2;j < output.length; j += columns) {
        if (dataLen[j] > lineMaxLength)
          lineMaxLength = dataLen[j];
      }
      lineMaxLength += separatorSpace;
      maxLineLength[i2] = lineMaxLength;
    }
    let order = StringPrototypePadStart;
    if (value !== @undefined) {
      for (let i2 = 0;i2 < output.length; i2++) {
        if (typeof value[i2] !== "number" && typeof value[i2] !== "bigint") {
          order = StringPrototypePadEnd;
          break;
        }
      }
    }
    for (let i2 = 0;i2 < outputLength; i2 += columns) {
      const max = MathMin(i2 + columns, outputLength);
      let str = "";
      let j = i2;
      for (;j < max - 1; j++) {
        const padding = maxLineLength[j - i2] + output[j].length - dataLen[j];
        str += order(`${output[j]}, `, padding, " ");
      }
      if (order === StringPrototypePadStart) {
        const padding = maxLineLength[j - i2] + output[j].length - dataLen[j] - separatorSpace;
        str += StringPrototypePadStart(output[j], padding, " ");
      } else {
        str += output[j];
      }
      ArrayPrototypePush(tmp, str);
    }
    if (ctx.maxArrayLength < output.length) {
      ArrayPrototypePush(tmp, output[outputLength]);
    }
    output = tmp;
  }
  return output;
};
var addNumericSeparator = function(integerString) {
  let result = "";
  let i = integerString.length;
  const start = StringPrototypeStartsWith(integerString, "-") ? 1 : 0;
  for (;i >= start + 4; i -= 3) {
    result = `_${StringPrototypeSlice(integerString, i - 3, i)}${result}`;
  }
  return i === integerString.length ? integerString : `${StringPrototypeSlice(integerString, 0, i)}${result}`;
};
var addNumericSeparatorEnd = function(integerString) {
  let result = "";
  let i = 0;
  for (;i < integerString.length - 3; i += 3) {
    result += `${StringPrototypeSlice(integerString, i, i + 3)}_`;
  }
  return i === 0 ? integerString : `${result}${StringPrototypeSlice(integerString, i)}`;
};
var formatNumber = function(fn, number, numericSeparator) {
  if (!numericSeparator) {
    if (ObjectIs(number, -0)) {
      return fn("-0", "number");
    }
    return fn(`${number}`, "number");
  }
  const integer = MathTrunc(number);
  const string = String(integer);
  if (integer === number) {
    if (!NumberIsFinite(number) || StringPrototypeIncludes(string, "e")) {
      return fn(string, "number");
    }
    return fn(`${addNumericSeparator(string)}`, "number");
  }
  if (NumberIsNaN(number)) {
    return fn(string, "number");
  }
  return fn(`${addNumericSeparator(string)}.${addNumericSeparatorEnd(StringPrototypeSlice(String(number), string.length + 1))}`, "number");
};
var formatBigInt = function(fn, bigint, numericSeparator) {
  const string = String(bigint);
  if (!numericSeparator) {
    return fn(`${string}n`, "bigint");
  }
  return fn(`${addNumericSeparator(string)}n`, "bigint");
};
var formatPrimitive = function(fn, value, ctx) {
  if (typeof value === "string") {
    let trailer = "";
    if (value.length > ctx.maxStringLength) {
      const remaining = value.length - ctx.maxStringLength;
      value = StringPrototypeSlice(value, 0, ctx.maxStringLength);
      trailer = `... ${remaining} more character${remaining > 1 ? "s" : ""}`;
    }
    if (ctx.compact !== true && value.length > kMinLineLength && value.length > ctx.breakLength - ctx.indentationLvl - 4) {
      return ArrayPrototypeJoin(ArrayPrototypeMap(extractedSplitNewLines(value), (line) => fn(strEscape(line), "string")), ` +\n${StringPrototypeRepeat(" ", ctx.indentationLvl + 2)}`) + trailer;
    }
    return fn(strEscape(value), "string") + trailer;
  }
  if (typeof value === "number")
    return formatNumber(fn, value, ctx.numericSeparator);
  if (typeof value === "bigint")
    return formatBigInt(fn, value, ctx.numericSeparator);
  if (typeof value === "boolean")
    return fn(`${value}`, "boolean");
  if (typeof value === "undefined")
    return fn("undefined", "undefined");
  return fn(SymbolPrototypeToString(value), "symbol");
};
var formatNamespaceObject = function(keys, ctx, value, recurseTimes) {
  const output = new Array(keys.length);
  for (let i = 0;i < keys.length; i++) {
    try {
      output[i] = formatProperty(ctx, value, recurseTimes, keys[i], kObjectType);
    } catch (err) {
      assert(isNativeError(err) && err.name === "ReferenceError");
      const tmp = { [keys[i]]: "" };
      output[i] = formatProperty(ctx, tmp, recurseTimes, keys[i], kObjectType);
      const pos = StringPrototypeLastIndexOf(output[i], " ");
      output[i] = StringPrototypeSlice(output[i], 0, pos + 1) + ctx.stylize("<uninitialized>", "special");
    }
  }
  keys.length = 0;
  return output;
};
var formatSpecialArray = function(ctx, value, recurseTimes, maxLength, output, i) {
  const keys = ObjectKeys(value);
  let index = i;
  for (;i < keys.length && output.length < maxLength; i++) {
    const key = keys[i];
    const tmp = +key;
    if (tmp > 4294967294) {
      break;
    }
    if (`${index}` !== key) {
      if (RegExpPrototypeExec(numberRegExp, key) === null) {
        break;
      }
      const emptyItems = tmp - index;
      const ending = emptyItems > 1 ? "s" : "";
      const message = `<${emptyItems} empty item${ending}>`;
      ArrayPrototypePush(output, ctx.stylize(message, "undefined"));
      index = tmp;
      if (output.length === maxLength) {
        break;
      }
    }
    ArrayPrototypePush(output, formatProperty(ctx, value, recurseTimes, key, kArrayType));
    index++;
  }
  const remaining = value.length - index;
  if (output.length !== maxLength) {
    if (remaining > 0) {
      const ending = remaining > 1 ? "s" : "";
      const message = `<${remaining} empty item${ending}>`;
      ArrayPrototypePush(output, ctx.stylize(message, "undefined"));
    }
  } else if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  return output;
};
var hexSlice = function(buf, start = 0, end) {
  return ArrayPrototypeJoin(ArrayPrototypeMap(buf.slice(start, end), (x) => ("00" + x.toString(16)).slice(-2)), "");
};
var formatArrayBuffer = function(ctx, value) {
  let buffer;
  try {
    buffer = new Uint8Array(value);
  } catch {
    return [ctx.stylize("(detached)", "special")];
  }
  let str = StringPrototypeTrim(RegExpPrototypeSymbolReplace(/(.{2})/g, hexSlice(buffer, 0, MathMin(ctx.maxArrayLength, buffer.length)), "$1 "));
  const remaining = buffer.length - ctx.maxArrayLength;
  if (remaining > 0)
    str += ` ... ${remaining} more byte${remaining > 1 ? "s" : ""}`;
  return [`${ctx.stylize("[Uint8Contents]", "special")}: <${str}>`];
};
var formatArray = function(ctx, value, recurseTimes) {
  const valLen = value.length;
  const len = MathMin(MathMax(0, ctx.maxArrayLength), valLen);
  const remaining = valLen - len;
  const output = [];
  for (let i = 0;i < len; i++) {
    if (!ObjectPrototypeHasOwnProperty(value, i)) {
      return formatSpecialArray(ctx, value, recurseTimes, len, output, i);
    }
    ArrayPrototypePush(output, formatProperty(ctx, value, recurseTimes, i, kArrayType));
  }
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  return output;
};
var formatTypedArray = function(value, length, ctx, ignored, recurseTimes) {
  const maxLength = MathMin(MathMax(0, ctx.maxArrayLength), length);
  const remaining = value.length - maxLength;
  const output = new Array(maxLength);
  const elementFormatter = value.length > 0 && typeof value[0] === "number" ? formatNumber : formatBigInt;
  for (let i = 0;i < maxLength; ++i) {
    output[i] = elementFormatter(ctx.stylize, value[i], ctx.numericSeparator);
  }
  if (remaining > 0) {
    output[maxLength] = remainingText(remaining);
  }
  if (ctx.showHidden) {
    ctx.indentationLvl += 2;
    for (const key of ["BYTES_PER_ELEMENT", "length", "byteLength", "byteOffset", "buffer"]) {
      const str = formatValue(ctx, value[key], recurseTimes, true);
      ArrayPrototypePush(output, `[${key}]: ${str}`);
    }
    ctx.indentationLvl -= 2;
  }
  return output;
};
var formatSet = function(value, ctx, ignored, recurseTimes) {
  const length = value.size;
  const maxLength = MathMin(MathMax(0, ctx.maxArrayLength), length);
  const remaining = length - maxLength;
  const output = [];
  ctx.indentationLvl += 2;
  let i = 0;
  for (const v of value) {
    if (i >= maxLength)
      break;
    ArrayPrototypePush(output, formatValue(ctx, v, recurseTimes));
    i++;
  }
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  ctx.indentationLvl -= 2;
  return output;
};
var formatMap = function(value, ctx, ignored, recurseTimes) {
  const length = value.size;
  const maxLength = MathMin(MathMax(0, ctx.maxArrayLength), length);
  const remaining = length - maxLength;
  const output = [];
  ctx.indentationLvl += 2;
  let i = 0;
  for (const { 0: k, 1: v } of value) {
    if (i >= maxLength)
      break;
    ArrayPrototypePush(output, `${formatValue(ctx, k, recurseTimes)} => ${formatValue(ctx, v, recurseTimes)}`);
    i++;
  }
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  ctx.indentationLvl -= 2;
  return output;
};
var formatSetIterInner = function(ctx, recurseTimes, entries, state) {
  const maxArrayLength = MathMax(ctx.maxArrayLength, 0);
  const maxLength = MathMin(maxArrayLength, entries.length);
  const output = new Array(maxLength);
  ctx.indentationLvl += 2;
  for (let i = 0;i < maxLength; i++) {
    output[i] = formatValue(ctx, entries[i], recurseTimes);
  }
  ctx.indentationLvl -= 2;
  if (state === kWeak && !ctx.sorted) {
    ArrayPrototypeSort(output);
  }
  const remaining = entries.length - maxLength;
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  return output;
};
var formatMapIterInner = function(ctx, recurseTimes, entries, state) {
  const maxArrayLength = MathMax(ctx.maxArrayLength, 0);
  const len = entries.length / 2;
  const remaining = len - maxArrayLength;
  const maxLength = MathMin(maxArrayLength, len);
  const output = new Array(maxLength);
  let i = 0;
  ctx.indentationLvl += 2;
  if (state === kWeak) {
    for (;i < maxLength; i++) {
      const pos = i * 2;
      output[i] = `${formatValue(ctx, entries[pos], recurseTimes)} => ${formatValue(ctx, entries[pos + 1], recurseTimes)}`;
    }
    if (!ctx.sorted)
      ArrayPrototypeSort(output);
  } else {
    for (;i < maxLength; i++) {
      const pos = i * 2;
      const res = [formatValue(ctx, entries[pos], recurseTimes), formatValue(ctx, entries[pos + 1], recurseTimes)];
      output[i] = reduceToSingleString(ctx, res, "", ["[", "]"], kArrayExtrasType, recurseTimes);
    }
  }
  ctx.indentationLvl -= 2;
  if (remaining > 0) {
    ArrayPrototypePush(output, remainingText(remaining));
  }
  return output;
};
var formatWeakCollection = function(ctx) {
  return [ctx.stylize("<items unknown>", "special")];
};
var formatWeakSet = function(ctx, value, recurseTimes) {
  const entries = previewEntries(value);
  return formatSetIterInner(ctx, recurseTimes, entries, kWeak);
};
var formatWeakMap = function(ctx, value, recurseTimes) {
  const entries = previewEntries(value);
  return formatMapIterInner(ctx, recurseTimes, entries, kWeak);
};
var formatIterator = function(braces, ctx, value, recurseTimes) {
  const { 0: entries, 1: isKeyValue } = previewEntries(value, true);
  if (isKeyValue) {
    braces[0] = RegExpPrototypeSymbolReplace(/ Iterator] {$/, braces[0], " Entries] {");
    return formatMapIterInner(ctx, recurseTimes, entries, kMapEntries);
  }
  return formatSetIterInner(ctx, recurseTimes, entries, kIterator);
};
var formatPromise = function(ctx, value, recurseTimes) {
  let output;
  const { 0: state, 1: result } = getPromiseDetails(value);
  if (state === kPending) {
    output = [ctx.stylize("<pending>", "special")];
  } else {
    ctx.indentationLvl += 2;
    const str = formatValue(ctx, result, recurseTimes);
    ctx.indentationLvl -= 2;
    output = [state === kRejected ? `${ctx.stylize("<rejected>", "special")} ${str}` : str];
  }
  return output;
};
var formatProperty = function(ctx, value, recurseTimes, key, type, desc, original = value) {
  let name, str;
  let extra = " ";
  desc ||= ObjectGetOwnPropertyDescriptor(value, key) || { value: value[key], enumerable: true };
  if (desc.value !== @undefined) {
    const diff = ctx.compact !== true || type !== kObjectType ? 2 : 3;
    ctx.indentationLvl += diff;
    str = formatValue(ctx, desc.value, recurseTimes);
    if (diff === 3 && ctx.breakLength < getStringWidth(str, ctx.colors)) {
      extra = `\n${StringPrototypeRepeat(" ", ctx.indentationLvl)}`;
    }
    ctx.indentationLvl -= diff;
  } else if (desc.get !== @undefined) {
    const label = desc.set !== @undefined ? "Getter/Setter" : "Getter";
    const s = ctx.stylize;
    const sp = "special";
    if (ctx.getters && (ctx.getters === true || ctx.getters === "get" && desc.set === @undefined || ctx.getters === "set" && desc.set !== @undefined)) {
      try {
        const tmp = desc.get.@call(original);
        ctx.indentationLvl += 2;
        if (tmp === null) {
          str = `${s(`[${label}:`, sp)} ${s("null", "null")}${s("]", sp)}`;
        } else if (typeof tmp === "object") {
          str = `${s(`[${label}]`, sp)} ${formatValue(ctx, tmp, recurseTimes)}`;
        } else {
          const primitive = formatPrimitive(s, tmp, ctx);
          str = `${s(`[${label}:`, sp)} ${primitive}${s("]", sp)}`;
        }
        ctx.indentationLvl -= 2;
      } catch (err) {
        const message = `<Inspection threw (${err.message})>`;
        str = `${s(`[${label}:`, sp)} ${message}${s("]", sp)}`;
      }
    } else {
      str = ctx.stylize(`[${label}]`, sp);
    }
  } else if (desc.set !== @undefined) {
    str = ctx.stylize("[Setter]", "special");
  } else {
    str = ctx.stylize("undefined", "undefined");
  }
  if (type === kArrayType)
    return str;
  if (typeof key === "symbol") {
    const tmp = RegExpPrototypeSymbolReplace(strEscapeSequencesReplacer, SymbolPrototypeToString(key), escapeFn);
    name = `[${ctx.stylize(tmp, "symbol")}]`;
  } else if (key === "__proto__") {
    name = "['__proto__']";
  } else if (desc.enumerable === false) {
    const tmp = RegExpPrototypeSymbolReplace(strEscapeSequencesReplacer, key, escapeFn);
    name = `[${tmp}]`;
  } else if (RegExpPrototypeExec(keyStrRegExp, key) !== null) {
    name = ctx.stylize(key, "name");
  } else {
    name = ctx.stylize(strEscape(key), "string");
  }
  return `${name}:${extra}${str}`;
};
var isBelowBreakLength = function(ctx, output, start, base) {
  let totalLength = output.length + start;
  if (totalLength + output.length > ctx.breakLength)
    return false;
  for (let i = 0;i < output.length; i++) {
    if (ctx.colors) {
      totalLength += StringPrototypeReplaceAll(output[i], /\u001B\[\d\d?m/g, "").length;
    } else {
      totalLength += output[i].length;
    }
    if (totalLength > ctx.breakLength) {
      return false;
    }
  }
  return base === "" || !StringPrototypeIncludes(base, "\n");
};
var reduceToSingleString = function(ctx, output, base, braces, extrasType, recurseTimes, value) {
  if (ctx.compact !== true) {
    if (typeof ctx.compact === "number" && ctx.compact >= 1) {
      const entries = output.length;
      if (extrasType === kArrayExtrasType && entries > 6) {
        output = groupArrayElements(ctx, output, value);
      }
      if (ctx.currentDepth - recurseTimes < ctx.compact && entries === output.length) {
        const start = output.length + ctx.indentationLvl + braces[0].length + base.length + 10;
        if (isBelowBreakLength(ctx, output, start, base)) {
          const joinedOutput = ArrayPrototypeJoin(output, ", ");
          if (!StringPrototypeIncludes(joinedOutput, "\n")) {
            return `${base ? `${base} ` : ""}${braces[0]} ${joinedOutput}` + ` ${braces[1]}`;
          }
        }
      }
    }
    const indentation2 = `\n${StringPrototypeRepeat(" ", ctx.indentationLvl)}`;
    return `${base ? `${base} ` : ""}${braces[0]}${indentation2}  ` + `${ArrayPrototypeJoin(output, `,${indentation2}  `)}${indentation2}${braces[1]}`;
  }
  if (isBelowBreakLength(ctx, output, 0, base)) {
    return `${braces[0]}${base ? ` ${base}` : ""} ${ArrayPrototypeJoin(output, ", ")} ` + braces[1];
  }
  const indentation = StringPrototypeRepeat(" ", ctx.indentationLvl);
  const ln = base === "" && braces[0].length === 1 ? " " : `${base ? ` ${base}` : ""}\n${indentation}  `;
  return `${braces[0]}${ln}${ArrayPrototypeJoin(output, `,\n${indentation}  `)} ${braces[1]}`;
};
var hasBuiltInToString = function(value) {
  const proxyTarget = getProxyDetails(value, false);
  if (proxyTarget !== @undefined) {
    if (proxyTarget === null)
      return true;
    value = proxyTarget;
  }
  if (typeof value.toString !== "function")
    return true;
  if (ObjectPrototypeHasOwnProperty(value, "toString"))
    return false;
  let pointer = value;
  do {
    pointer = ObjectGetPrototypeOf(pointer);
  } while (!ObjectPrototypeHasOwnProperty(pointer, "toString"));
  const descriptor = ObjectGetOwnPropertyDescriptor(pointer, "constructor");
  return descriptor !== @undefined && typeof descriptor.value === "function" && builtInObjects.has(descriptor.value.name);
};
var tryStringify = function(arg) {
  try {
    return JSONStringify(arg);
  } catch (err) {
    if (!CIRCULAR_ERROR_MESSAGE) {
      try {
        const a = {};
        a.a = a;
        JSONStringify(a);
      } catch (circularError) {
        CIRCULAR_ERROR_MESSAGE = firstErrorLine(circularError);
      }
    }
    if (err.name === "TypeError" && firstErrorLine(err) === CIRCULAR_ERROR_MESSAGE) {
      return "[Circular]";
    }
    throw err;
  }
};
var format = function(...args) {
  return formatWithOptionsInternal(@undefined, args);
};
var formatWithOptions = function(inspectOptions, ...args) {
  validateObject(inspectOptions, "inspectOptions", { allowArray: true });
  return formatWithOptionsInternal(inspectOptions, args);
};
var formatNumberNoColor = function(number, options) {
  return formatNumber(stylizeNoColor, number, options?.numericSeparator ?? inspectDefaultOptions.numericSeparator);
};
var formatBigIntNoColor = function(bigint, options) {
  return formatBigInt(stylizeNoColor, bigint, options?.numericSeparator ?? inspectDefaultOptions.numericSeparator);
};
var formatWithOptionsInternal = function(inspectOptions, args) {
  const first = args[0];
  let a = 0;
  let str = "";
  let join = "";
  if (typeof first === "string") {
    if (args.length === 1) {
      return first;
    }
    let tempStr;
    let lastPos = 0;
    for (let i = 0;i < first.length - 1; i++) {
      if (StringPrototypeCharCodeAt(first, i) === 37) {
        const nextChar = StringPrototypeCharCodeAt(first, ++i);
        if (a + 1 !== args.length) {
          switch (nextChar) {
            case 115: {
              const tempArg = args[++a];
              if (typeof tempArg === "number") {
                tempStr = formatNumberNoColor(tempArg, inspectOptions);
              } else if (typeof tempArg === "bigint") {
                tempStr = formatBigIntNoColor(tempArg, inspectOptions);
              } else if (typeof tempArg !== "object" || tempArg === null || !hasBuiltInToString(tempArg)) {
                tempStr = String(tempArg);
              } else {
                tempStr = inspect(tempArg, {
                  ...inspectOptions,
                  compact: 3,
                  colors: false,
                  depth: 0
                });
              }
              break;
            }
            case 106:
              tempStr = tryStringify(args[++a]);
              break;
            case 100: {
              const tempNum = args[++a];
              if (typeof tempNum === "bigint") {
                tempStr = formatBigIntNoColor(tempNum, inspectOptions);
              } else if (typeof tempNum === "symbol") {
                tempStr = "NaN";
              } else {
                tempStr = formatNumberNoColor(Number(tempNum), inspectOptions);
              }
              break;
            }
            case 79:
              tempStr = inspect(args[++a], inspectOptions);
              break;
            case 111:
              tempStr = inspect(args[++a], {
                ...inspectOptions,
                showHidden: true,
                showProxy: true,
                depth: 4
              });
              break;
            case 105: {
              const tempInteger = args[++a];
              if (typeof tempInteger === "bigint") {
                tempStr = formatBigIntNoColor(tempInteger, inspectOptions);
              } else if (typeof tempInteger === "symbol") {
                tempStr = "NaN";
              } else {
                tempStr = formatNumberNoColor(NumberParseInt(tempInteger), inspectOptions);
              }
              break;
            }
            case 102: {
              const tempFloat = args[++a];
              if (typeof tempFloat === "symbol") {
                tempStr = "NaN";
              } else {
                tempStr = formatNumberNoColor(NumberParseFloat(tempFloat), inspectOptions);
              }
              break;
            }
            case 99:
              a += 1;
              tempStr = "";
              break;
            case 37:
              str += StringPrototypeSlice(first, lastPos, i);
              lastPos = i + 1;
              continue;
            default:
              continue;
          }
          if (lastPos !== i - 1) {
            str += StringPrototypeSlice(first, lastPos, i - 1);
          }
          str += tempStr;
          lastPos = i + 1;
        } else if (nextChar === 37) {
          str += StringPrototypeSlice(first, lastPos, i);
          lastPos = i + 1;
        }
      }
    }
    if (lastPos !== 0) {
      a++;
      join = " ";
      if (lastPos < first.length) {
        str += StringPrototypeSlice(first, lastPos);
      }
    }
  }
  while (a < args.length) {
    const value = args[a];
    str += join;
    str += typeof value !== "string" ? inspect(value, inspectOptions) : value;
    join = " ";
    a++;
  }
  return str;
};
var isZeroWidthCodePoint = function(code) {
  return code <= 31 || code >= 127 && code <= 159 || code >= 768 && code <= 879 || code >= 8203 && code <= 8207 || code >= 8400 && code <= 8447 || code >= 65024 && code <= 65039 || code >= 65056 && code <= 65071 || code >= 917760 && code <= 917999;
};
var stripVTControlCharacters = function(str) {
  if (typeof str !== "string")
    throw new codes.ERR_INVALID_ARG_TYPE("str", "string", str);
  return RegExpPrototypeSymbolReplace(ansi, str, "");
};
var getOwnNonIndexProperties = function(a, filter = ONLY_ENUMERABLE) {
  const desc = ObjectGetOwnPropertyDescriptors(a);
  const ret = [];
  for (const [k, v] of ObjectEntries(desc)) {
    if (!RegExpPrototypeTest(/^(0|[1-9][0-9]*)$/, k) || NumberParseInt(k, 10) >= 4294967295) {
      if (filter === ONLY_ENUMERABLE && !v.enumerable)
        continue;
      else
        ArrayPrototypePush(ret, k);
    }
  }
  for (const s of ObjectGetOwnPropertySymbols(a)) {
    const v = ObjectGetOwnPropertyDescriptor(a, s);
    if (filter === ONLY_ENUMERABLE && !v.enumerable)
      continue;
    ArrayPrototypePush(ret, s);
  }
  return ret;
};
var getPromiseDetails = function(promise) {
  const state = @getPromiseInternalField(promise, @promiseFieldFlags) & @promiseStateMask;
  if (state !== @promiseStatePending) {
    return [
      state === @promiseStateRejected ? kRejected : kFulfilled,
      @getPromiseInternalField(promise, @promiseFieldReactionsOrResult)
    ];
  }
  return [kPending, @undefined];
};
var getProxyDetails = function(proxy, withHandler = true) {
  const isProxy = @isProxyObject(proxy);
  if (!isProxy)
    return @undefined;
  const handler = @getProxyInternalField(proxy, @proxyFieldHandler);
  const target = handler === null ? null : @getProxyInternalField(proxy, @proxyFieldTarget);
  if (withHandler)
    return [target, handler];
  else
    return target;
};
var previewEntries = function(val, isIterator = false) {
  if (isIterator) {
    const iteratedObject = @getInternalField(val, 1);
    const kind = @getInternalField(val, 2);
    const isEntries = kind === 2;
    if (@isMap(iteratedObject)) {
      if (isEntries)
        return [ArrayPrototypeFlat(ArrayFrom(iteratedObject)), true];
      else if (kind === 1)
        return [ArrayFrom(MapPrototypeValues(iteratedObject)), false];
      else
        return [ArrayFrom(MapPrototypeKeys(iteratedObject)), false];
    } else if (@isSet(iteratedObject)) {
      if (isEntries)
        return [ArrayPrototypeFlat(ArrayFrom(SetPrototypeEntries(iteratedObject))), true];
      else
        return [ArrayFrom(iteratedObject), false];
    } else
      throw new Error("previewEntries(): Invalid iterator received");
  }
  if (isWeakMap(val))
    return [];
  if (isWeakSet(val))
    return [];
  else
    throw new Error("previewEntries(): Invalid object received");
};
var internalGetConstructorName = function(val) {
  if (!val || typeof val !== "object")
    throw new Error("Invalid object");
  if (val.constructor?.name)
    return val.constructor.name;
  const str = ObjectPrototypeToString(val);
  const m = StringPrototypeMatch(str, /^\[object ([^\]]+)\]/);
  return m ? m[1] : "Object";
};
var $;
var { pathToFileURL } = @getInternalField(@internalModuleRegistry, 47) || @createInternalModuleById(47);
var primordials = @getInternalField(@internalModuleRegistry, 5) || @createInternalModuleById(5);
var {
  Array,
  ArrayFrom,
  ArrayIsArray,
  ArrayPrototypeFilter,
  ArrayPrototypeFlat,
  ArrayPrototypeForEach,
  ArrayPrototypeIncludes,
  ArrayPrototypeIndexOf,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePop,
  ArrayPrototypePush,
  ArrayPrototypePushApply,
  ArrayPrototypeSlice,
  ArrayPrototypeSplice,
  ArrayPrototypeSort,
  ArrayPrototypeUnshift,
  BigIntPrototypeValueOf,
  BooleanPrototypeValueOf,
  DatePrototypeGetTime,
  DatePrototypeToISOString,
  DatePrototypeToString,
  ErrorCaptureStackTrace,
  ErrorPrototypeToString,
  FunctionPrototypeBind,
  FunctionPrototypeToString,
  JSONStringify,
  MapPrototypeGetSize,
  MapPrototypeEntries,
  MapPrototypeValues,
  MapPrototypeKeys,
  MathFloor,
  MathMax,
  MathMin,
  MathRound,
  MathSqrt,
  MathTrunc,
  Number,
  NumberIsFinite,
  NumberIsNaN,
  NumberParseFloat,
  NumberParseInt,
  NumberPrototypeToString,
  NumberPrototypeValueOf,
  Object,
  ObjectAssign,
  ObjectDefineProperty,
  ObjectEntries,
  ObjectGetOwnPropertyDescriptor,
  ObjectGetOwnPropertyDescriptors,
  ObjectGetOwnPropertyNames,
  ObjectGetOwnPropertySymbols,
  ObjectGetPrototypeOf,
  ObjectIs,
  ObjectKeys,
  ObjectPrototypeHasOwnProperty,
  ObjectPrototypePropertyIsEnumerable,
  ObjectPrototypeToString,
  ObjectSeal,
  ObjectSetPrototypeOf,
  ReflectApply,
  ReflectOwnKeys,
  RegExp,
  RegExpPrototypeExec,
  RegExpPrototypeSymbolReplace,
  RegExpPrototypeSymbolSplit,
  RegExpPrototypeTest,
  RegExpPrototypeToString,
  SafeStringIterator,
  SafeMap,
  SafeSet,
  SetPrototypeEntries,
  SetPrototypeGetSize,
  SetPrototypeValues,
  String,
  StringPrototypeCharCodeAt,
  StringPrototypeCodePointAt,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeMatch,
  StringPrototypeNormalize,
  StringPrototypePadEnd,
  StringPrototypePadStart,
  StringPrototypeRepeat,
  StringPrototypeReplaceAll,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeEndsWith,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
  StringPrototypeValueOf,
  SymbolPrototypeToString,
  SymbolPrototypeValueOf,
  SymbolIterator,
  SymbolToStringTag,
  TypedArrayPrototypeGetLength,
  TypedArrayPrototypeGetSymbolToStringTag,
  Uint8Array
} = primordials;
var customInspectSymbol = Symbol.for("nodejs.util.inspect.custom");
var kPending = Symbol("kPending");
var kFulfilled = Symbol("kFulfilled");
var kRejected = Symbol("kRejected");
var ALL_PROPERTIES = 0;
var ONLY_ENUMERABLE = 2;
var isAsyncFunction = (v) => typeof v === "function" && StringPrototypeStartsWith(FunctionPrototypeToString(v), "async");
var isGeneratorFunction = (v) => typeof v === "function" && StringPrototypeMatch(FunctionPrototypeToString(v), /^(async\s+)?function *\*/);
var isBigIntObject = checkBox(BigInt);
var isSymbolObject = checkBox(Symbol);
var {
  isAnyArrayBuffer,
  isArrayBuffer,
  isArgumentsObject,
  isBoxedPrimitive: _native_isBoxedPrimitive,
  isDataView,
  isExternal,
  isMap,
  isMapIterator,
  isModuleNamespaceObject,
  isNativeError,
  isPromise,
  isSet,
  isSetIterator,
  isWeakMap,
  isWeakSet,
  isRegExp,
  isDate,
  isTypedArray,
  isStringObject,
  isNumberObject,
  isBooleanObject
} = @requireNativeModule("util/types");
//! The native versions of the commented out functions are currently buggy, so we use the polyfills above for now.
//! temp workaround to apply is{BigInt,Symbol}Object fix
var isBoxedPrimitive = (val) => isBigIntObject(val) || isSymbolObject(val) || _native_isBoxedPrimitive(val);

class AssertionError extends Error {
  constructor(message, isForced = false) {
    super(message);
    this.name = "AssertionError";
    this.code = "ERR_ASSERTION";
    this.operator = "==";
    this.generatedMessage = !isForced;
    this.actual = isForced && @undefined;
    this.expected = !isForced || @undefined;
  }
}
var codes = {};
{
  const kTypes = [
    "string",
    "function",
    "number",
    "object",
    "Function",
    "Object",
    "boolean",
    "bigint",
    "symbol"
  ];
  const classRegExp = /^([A-Z][a-z0-9]*)+$/;
  const messages = new SafeMap;
  const sym = "ERR_INVALID_ARG_TYPE";
  messages.set(sym, (name, expected, actual) => {
    assert(typeof name === "string", "'name' must be a string");
    if (!ArrayIsArray(expected))
      expected = [expected];
    let msg = "The ";
    if (StringPrototypeEndsWith(name, " argument"))
      msg += `${name} `;
    else
      msg += `"${name}" ${StringPrototypeIncludes(name, ".") ? "property" : "argument"} `;
    msg += "must be ";
    const types = [];
    const instances = [];
    const other = [];
    for (const value of expected) {
      assert(typeof value === "string", "All expected entries have to be of type string");
      if (ArrayPrototypeIncludes(kTypes, value))
        ArrayPrototypePush(types, StringPrototypeToLowerCase(value));
      else if (RegExpPrototypeTest(classRegExp, value))
        ArrayPrototypePush(instances, value);
      else {
        assert(value !== "object", 'The value "object" should be written as "Object"');
        ArrayPrototypePush(other, value);
      }
    }
    if (instances.length > 0) {
      const pos = ArrayPrototypeIndexOf(types, "object");
      if (pos !== -1) {
        ArrayPrototypeSplice(types, pos, 1);
        ArrayPrototypePush(instances, "Object");
      }
    }
    if (types.length > 0) {
      if (types.length > 2)
        msg += `one of type ${ArrayPrototypeJoin(types, ", ")}, or ${ArrayPrototypePop(types)}`;
      else if (types.length === 2)
        msg += `one of type ${types[0]} or ${types[1]}`;
      else
        msg += `of type ${types[0]}`;
      if (instances.length > 0 || other.length > 0)
        msg += " or ";
    }
    if (instances.length > 0) {
      if (instances.length > 2)
        msg += `an instance of ${ArrayPrototypeJoin(instances, ", ")}, or ${ArrayPrototypePop(instances)}`;
      else
        msg += `an instance of ${instances[0]}` + (instances.length === 2 ? ` or ${instances[1]}` : "");
      if (other.length > 0)
        msg += " or ";
    }
    if (other.length > 0) {
      if (other.length > 2) {
        const last = ArrayPrototypePop(other);
        msg += `one of ${ArrayPrototypeJoin(other, ", ")}, or ${last}`;
      } else if (other.length === 2) {
        msg += `one of ${other[0]} or ${other[1]}`;
      } else {
        if (StringPrototypeToLowerCase(other[0]) !== other[0])
          msg += "an ";
        msg += `${other[0]}`;
      }
    }
    if (actual == null)
      msg += `. Received ${actual}`;
    else if (typeof actual === "function" && actual.name)
      msg += `. Received function ${actual.name}`;
    else if (typeof actual === "object") {
      if (actual.constructor && actual.constructor.name)
        msg += `. Received an instance of ${actual.constructor.name}`;
      else
        msg += `. Received ${inspect(actual, { depth: -1 })}`;
    } else {
      let inspected = inspect(actual, { colors: false });
      if (inspected.length > 25)
        inspected = `${StringPrototypeSlice(inspected, 0, 25)}...`;
      msg += `. Received type ${typeof actual} (${inspected})`;
    }
    return msg;
  });
  codes[sym] = function NodeError(...args) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    const error = @makeTypeError();
    Error.stackTraceLimit = limit;
    const msg = messages.get(sym);
    assert(typeof msg === "function");
    assert(msg.length <= args.length, `Code: ${sym}; The provided arguments length (${args.length}) does not match the required ones (${msg.length}).`);
    const message = ReflectApply(msg, error, args);
    ObjectDefineProperty(error, "message", { value: message, enumerable: false, writable: true, configurable: true });
    ObjectDefineProperty(error, "toString", {
      value() {
        return `${this.name} [${sym}]: ${this.message}`;
      },
      enumerable: false,
      writable: true,
      configurable: true
    });
    let err = error;
    const userStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = @Infinity;
    ErrorCaptureStackTrace(err);
    Error.stackTraceLimit = userStackTraceLimit;
    err.name = `${TypeError.name} [${sym}]`;
    err.stack;
    delete err.name;
    error.code = sym;
    return error;
  };
}
var validateObject = (value, name, allowArray = false) => {
  if (value === null || !allowArray && ArrayIsArray(value) || typeof value !== "object" && typeof value !== "function")
    throw new codes.ERR_INVALID_ARG_TYPE(name, "Object", value);
};
var builtInObjects = new SafeSet(ArrayPrototypeFilter(ObjectGetOwnPropertyNames(globalThis), (e) => RegExpPrototypeExec(/^[A-Z][a-zA-Z0-9]+$/, e) !== null));
var isUndetectableObject = (v) => typeof v === "undefined" && v !== @undefined;
var ERROR_STACK_OVERFLOW_MSG = "Maximum call stack size exceeded.";
var inspectDefaultOptions = ObjectSeal({
  showHidden: false,
  depth: 2,
  colors: false,
  customInspect: true,
  showProxy: false,
  maxArrayLength: 100,
  maxStringLength: 1e4,
  breakLength: 80,
  compact: 3,
  sorted: false,
  getters: false,
  numericSeparator: false
});
var inspectReplDefaults = ObjectSeal({
  ...inspectDefaultOptions,
  colors: Bun.enableANSIColors,
  showProxy: true
});
var kObjectType = 0;
var kArrayType = 1;
var kArrayExtrasType = 2;
var strEscapeSequencesRegExp;
var strEscapeSequencesReplacer;
var strEscapeSequencesRegExpSingle;
var strEscapeSequencesReplacerSingle;
var extractedSplitNewLines;
try {
  strEscapeSequencesRegExp = new RegExp("[\\x00-\\x1f\\x27\\x5c\\x7f-\\x9f]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]");
  strEscapeSequencesReplacer = new RegExp("[\0-\\x1f\\x27\\x5c\\x7f-\\x9f]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]", "g");
  strEscapeSequencesRegExpSingle = new RegExp("[\\x00-\\x1f\\x5c\\x7f-\\x9f]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]");
  strEscapeSequencesReplacerSingle = new RegExp("[\\x00-\\x1f\\x5c\\x7f-\\x9f]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]", "g");
  const extractedNewLineRe = new RegExp("(?<=\\n)");
  extractedSplitNewLines = (value) => RegExpPrototypeSymbolSplit(extractedNewLineRe, value);
} catch {
  strEscapeSequencesRegExp = /[\x00-\x1f\x27\x5c\x7f-\x9f]/;
  strEscapeSequencesReplacer = /[\x00-\x1f\x27\x5c\x7f-\x9f]/g;
  strEscapeSequencesRegExpSingle = /[\x00-\x1f\x5c\x7f-\x9f]/;
  strEscapeSequencesReplacerSingle = /[\x00-\x1f\x5c\x7f-\x9f]/g;
  extractedSplitNewLines = (value) => {
    const lines = RegExpPrototypeSymbolSplit(/\n/, value);
    const last = ArrayPrototypePop(lines);
    const nlLines = ArrayPrototypeMap(lines, (line) => line + "\n");
    if (last !== "") {
      nlLines.push(last);
    }
    return nlLines;
  };
}
var keyStrRegExp = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
var numberRegExp = /^(0|[1-9][0-9]*)$/;
var coreModuleRegExp = /^ {4}at (?:[^/\\(]+ \(|)node:(.+):\d+:\d+\)?$/;
var nodeModulesRegExp = /[/\\]node_modules[/\\](.+?)(?=[/\\])/g;
var classRegExp = /^(\s+[^(]*?)\s*{/;
var stripCommentsRegExp = /(\/\/.*?\n)|(\/\*(.|\n)*?\*\/)/g;
var kMinLineLength = 16;
var kWeak = 0;
var kIterator = 1;
var kMapEntries = 2;
var meta = [
  "\\x00",
  "\\x01",
  "\\x02",
  "\\x03",
  "\\x04",
  "\\x05",
  "\\x06",
  "\\x07",
  "\\b",
  "\\t",
  "\\n",
  "\\x0B",
  "\\f",
  "\\r",
  "\\x0E",
  "\\x0F",
  "\\x10",
  "\\x11",
  "\\x12",
  "\\x13",
  "\\x14",
  "\\x15",
  "\\x16",
  "\\x17",
  "\\x18",
  "\\x19",
  "\\x1A",
  "\\x1B",
  "\\x1C",
  "\\x1D",
  "\\x1E",
  "\\x1F",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "\\'",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "\\\\",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "\\x7F",
  "\\x80",
  "\\x81",
  "\\x82",
  "\\x83",
  "\\x84",
  "\\x85",
  "\\x86",
  "\\x87",
  "\\x88",
  "\\x89",
  "\\x8A",
  "\\x8B",
  "\\x8C",
  "\\x8D",
  "\\x8E",
  "\\x8F",
  "\\x90",
  "\\x91",
  "\\x92",
  "\\x93",
  "\\x94",
  "\\x95",
  "\\x96",
  "\\x97",
  "\\x98",
  "\\x99",
  "\\x9A",
  "\\x9B",
  "\\x9C",
  "\\x9D",
  "\\x9E",
  "\\x9F"
];
var getStringWidth;
inspect.custom = customInspectSymbol;
ObjectDefineProperty(inspect, "defaultOptions", {
  __proto__: null,
  get() {
    return inspectDefaultOptions;
  },
  set(options) {
    validateObject(options, "options");
    return ObjectAssign(inspectDefaultOptions, options);
  }
});
ObjectDefineProperty(inspect, "replDefaults", {
  __proto__: null,
  get() {
    return inspectReplDefaults;
  },
  set(options) {
    validateObject(options, "options");
    return ObjectAssign(inspectReplDefaults, options);
  }
});
var defaultFG = 39;
var defaultBG = 49;
inspect.colors = {
  __proto__: null,
  reset: [0, 0],
  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  blink: [5, 25],
  inverse: [7, 27],
  hidden: [8, 28],
  strikethrough: [9, 29],
  doubleunderline: [21, 24],
  black: [30, defaultFG],
  red: [31, defaultFG],
  green: [32, defaultFG],
  yellow: [33, defaultFG],
  blue: [34, defaultFG],
  magenta: [35, defaultFG],
  cyan: [36, defaultFG],
  white: [37, defaultFG],
  bgBlack: [40, defaultBG],
  bgRed: [41, defaultBG],
  bgGreen: [42, defaultBG],
  bgYellow: [43, defaultBG],
  bgBlue: [44, defaultBG],
  bgMagenta: [45, defaultBG],
  bgCyan: [46, defaultBG],
  bgWhite: [47, defaultBG],
  framed: [51, 54],
  overlined: [53, 55],
  gray: [90, defaultFG],
  redBright: [91, defaultFG],
  greenBright: [92, defaultFG],
  yellowBright: [93, defaultFG],
  blueBright: [94, defaultFG],
  magentaBright: [95, defaultFG],
  cyanBright: [96, defaultFG],
  whiteBright: [97, defaultFG],
  bgGray: [100, defaultBG],
  bgRedBright: [101, defaultBG],
  bgGreenBright: [102, defaultBG],
  bgYellowBright: [103, defaultBG],
  bgBlueBright: [104, defaultBG],
  bgMagentaBright: [105, defaultBG],
  bgCyanBright: [106, defaultBG],
  bgWhiteBright: [107, defaultBG]
};
defineColorAlias("gray", "grey");
defineColorAlias("gray", "blackBright");
defineColorAlias("bgGray", "bgGrey");
defineColorAlias("bgGray", "bgBlackBright");
defineColorAlias("dim", "faint");
defineColorAlias("strikethrough", "crossedout");
defineColorAlias("strikethrough", "strikeThrough");
defineColorAlias("strikethrough", "crossedOut");
defineColorAlias("hidden", "conceal");
defineColorAlias("inverse", "swapColors");
defineColorAlias("inverse", "swapcolors");
defineColorAlias("doubleunderline", "doubleUnderline");
inspect.styles = {
  __proto__: null,
  special: "cyan",
  number: "yellow",
  bigint: "yellow",
  boolean: "yellow",
  undefined: "grey",
  null: "bold",
  string: "green",
  symbol: "green",
  date: "magenta",
  regexp: "red",
  module: "underline"
};
var remainingText = (remaining) => `... ${remaining} more item${remaining > 1 ? "s" : ""}`;
var firstErrorLine = (error) => StringPrototypeSplit(error.message, "\n", 1)[0];
var CIRCULAR_ERROR_MESSAGE;
{
  getStringWidth = function getStringWidth(str, removeControlChars = true) {
    let width = 0;
    if (removeControlChars)
      str = stripVTControlCharacters(str);
    str = StringPrototypeNormalize(str, "NFC");
    for (const char of new SafeStringIterator(str)) {
      const code = StringPrototypeCodePointAt(char, 0);
      if (isFullWidthCodePoint(code)) {
        width += 2;
      } else if (!isZeroWidthCodePoint(code)) {
        width++;
      }
    }
    return width;
  };
  const isFullWidthCodePoint = (code) => {
    return code >= 4352 && (code <= 4447 || code === 9001 || code === 9002 || code >= 11904 && code <= 12871 && code !== 12351 || code >= 12880 && code <= 19903 || code >= 19968 && code <= 42182 || code >= 43360 && code <= 43388 || code >= 44032 && code <= 55203 || code >= 63744 && code <= 64255 || code >= 65040 && code <= 65049 || code >= 65072 && code <= 65131 || code >= 65281 && code <= 65376 || code >= 65504 && code <= 65510 || code >= 110592 && code <= 110593 || code >= 127488 && code <= 127569 || code >= 127744 && code <= 128591 || code >= 131072 && code <= 262141);
  };
}
var ansiPattern = "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))";
var ansi = new RegExp(ansiPattern, "g");
$ = {
  inspect,
  format,
  formatWithOptions,
  stripVTControlCharacters
};
//! non-standard properties, should these be kept? (not currently exposed)
return $})
