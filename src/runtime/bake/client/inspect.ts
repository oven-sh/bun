/* This file provides utilities for inspecting and formatting JavaScript values in client-side code.
 * It implements a Node.js-like `inspect` function that converts any JavaScript value
 * into a string representation, handling circular references, various object types,
 * and respecting customization options.
 *
 * The implementation supports:
 * - Primitive values (strings, numbers, booleans, etc.)
 * - Complex objects and arrays with customizable depth
 * - Special handling for typed arrays, Sets, Maps, and ArrayBuffers
 * - Configurable output formatting (indentation, truncation, etc.)
 *
 * This is mostly intended for pretty printing console.log from browser to CLI.
 *
 * The formatter runs inside the page's console.log, so it must not run code of the page: a
 * getter, an overridden method, or Symbol.for("nodejs.util.inspect.custom"). It reads a property
 * of a page object from the property descriptor, and it applies only the built-ins that
 * `installInspect` captured. A Proxy still runs its traps for the descriptor, the keys and the
 * prototype. `formatValue` catches what a trap throws.
 */

type Builtin<T> = (this: unknown) => T;

// Built-ins that read an internal slot of `this`. Each one throws for an object without the
// slot, and that tells a Map from a Proxy of a Map.
let mapSize: Builtin<number>;
let mapEntries: Builtin<Iterator<[unknown, unknown]>>;
let mapIteratorNext: Builtin<IteratorResult<[unknown, unknown]>>;
let setSize: Builtin<number>;
let setValues: Builtin<Iterator<unknown>>;
let setIteratorNext: Builtin<IteratorResult<unknown>>;
let dateGetTime: Builtin<number>;
let dateToISOString: Builtin<string>;
let regExpSource: Builtin<string>;
let regExpFlagGetters: Builtin<boolean>[];
let regExpFlags: string;
let typedArrayLength: Builtin<number>;
let arrayBufferByteLength: Builtin<number>;

let functionToString: Builtin<string>;
let nativeGetterSource: RegExp;
// V8 gives every error the same own `stack` accessor, and its source has no name.
// SpiderMonkey has the accessor on Error.prototype. JavaScriptCore uses a data property.
let errorStackGetter: Function | undefined;
let builtinKinds: Map<object, BuiltinKind>;
let isInspecting = false;

const enum BuiltinKind {
  None,
  Date,
  RegExp,
  Error,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Promise,
  ArrayBuffer,
}

// A Proxy can answer getPrototypeOf with a new Proxy each time, so a walk needs a limit.
const maxPrototypeChain = 32;

/**
 * Capture the built-ins that `inspect` applies to page values.
 * Call it before a module of the page runs, because a page can replace a built-in.
 */
export function installInspect() {
  const getter = (prototype: object, key: string) => Object.getOwnPropertyDescriptor(prototype, key)!.get!;
  mapSize = getter(Map.prototype, "size");
  mapEntries = Map.prototype.entries;
  mapIteratorNext = Object.getPrototypeOf(new Map().entries()).next;
  setSize = getter(Set.prototype, "size");
  setValues = Set.prototype.values;
  setIteratorNext = Object.getPrototypeOf(new Set().values()).next;
  dateGetTime = Date.prototype.getTime;
  dateToISOString = Date.prototype.toISOString;
  regExpSource = getter(RegExp.prototype, "source");
  // An engine does not have every flag. `RegExp.prototype.flags` reads the flags with getters of the page.
  regExpFlagGetters = [];
  regExpFlags = "";
  for (const [flag, key] of [
    ["d", "hasIndices"],
    ["g", "global"],
    ["i", "ignoreCase"],
    ["m", "multiline"],
    ["s", "dotAll"],
    ["u", "unicode"],
    ["v", "unicodeSets"],
    ["y", "sticky"],
  ]) {
    const flagGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get;
    if (flagGetter) {
      regExpFlagGetters.push(flagGetter);
      regExpFlags += flag;
    }
  }
  typedArrayLength = getter(Object.getPrototypeOf(Uint8Array.prototype), "length");
  arrayBufferByteLength = getter(ArrayBuffer.prototype, "byteLength");
  functionToString = Function.prototype.toString;
  errorStackGetter = (
    Object.getOwnPropertyDescriptor(new Error(), "stack") ?? Object.getOwnPropertyDescriptor(Error.prototype, "stack")
  )?.get;
  // `function get href() { [native code] }`. V8 prints a bound function and a callable Proxy
  // with no name, so the name keeps those out.
  nativeGetterSource = /^function (?:get )?[\w$]+\(\)\s*\{\s*\[native code\]\s*\}$/;
  builtinKinds = new Map<object, BuiltinKind>([
    [Date.prototype, BuiltinKind.Date],
    [RegExp.prototype, BuiltinKind.RegExp],
    [Error.prototype, BuiltinKind.Error],
    [Map.prototype, BuiltinKind.Map],
    [Set.prototype, BuiltinKind.Set],
    [WeakMap.prototype, BuiltinKind.WeakMap],
    [WeakSet.prototype, BuiltinKind.WeakSet],
    [Promise.prototype, BuiltinKind.Promise],
    [ArrayBuffer.prototype, BuiltinKind.ArrayBuffer],
  ]);
}

export interface InspectOptions {
  showHidden?: boolean;
  depth?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
  breakLength?: number;
  compact?: number;
  sorted?: boolean;
  getters?: boolean;
  numericSeparator?: boolean;
}

export interface InspectContext extends InspectOptions {
  seen: any[];
  currentDepth: number;
}
// Default options
const defaultOptions: InspectOptions = {
  showHidden: false,
  depth: 2,
  maxArrayLength: 100,
  maxStringLength: 10000,
  breakLength: 80,
  compact: 3,
  sorted: false,
  getters: false,
  numericSeparator: false,
} as const;

/**
 * Main inspection function
 * @param {any} obj - Object to inspect
 * @param {Object} options - Configuration options
 * @returns {string} String representation
 */
export function inspect(obj: any, options: InspectOptions = {}) {
  // The traps of a Proxy run while the Proxy prints, and a trap can log the same Proxy. A call
  // from inside a trap prints a tag for an object, so that the calls do not nest without end.
  const wasInspecting = isInspecting;
  if (wasInspecting && obj !== null && (typeof obj === "object" || typeof obj === "function")) {
    return typeof obj === "function" ? "[Function]" : "[Object]";
  }

  // Set up context with merged options
  const ctx: InspectContext = {
    seen: [],
    currentDepth: 0,
    ...defaultOptions,
    ...options,
  } as InspectContext;

  isInspecting = true;
  try {
    return formatValue(ctx, obj, 0);
  } finally {
    isInspecting = wasInspecting;
  }
}

/**
 * Format a value based on its type
 * @param {Object} ctx - Context object with settings
 * @param {any} value - Value to format
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string} Formatted value
 */
function formatValue(ctx: InspectContext, value: any, recurseTimes: number): string {
  // Handle primitive types
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  // Check for circular references
  if (ctx.seen.includes(value)) {
    return "[Circular]";
  }

  // Format based on type
  switch (typeof value) {
    case "string":
      return formatString(ctx, value);
    case "number":
      return formatNumber(value, ctx.numericSeparator!);
    case "bigint":
      return `${value}n`;
    case "boolean":
      return `${value}`;
    case "symbol":
      return formatSymbol(value);
    case "function":
    case "object": {
      // A trap of a Proxy, a revoked Proxy or a cross-origin object can throw from any read.
      const seenLength = ctx.seen.length;
      try {
        return typeof value === "function" ? formatFunction(value) : formatObject(ctx, value, recurseTimes);
      } catch {
        ctx.seen.length = seenLength;
        return "[threw while printing]";
      }
    }
    default:
      return String(value);
  }
}

/**
 * Find a property on an object or on its prototypes
 * @param {Object} obj - Object to inspect
 * @param {string} key - Property key
 * @returns {PropertyDescriptor|undefined} Descriptor of the property, if it exists
 */
function findDescriptor(obj: object | null, key: string) {
  for (let i = 0; obj !== null && i < maxPrototypeChain; i++) {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (desc) return desc;
    obj = Object.getPrototypeOf(obj);
  }
}

/**
 * Check that the engine implements a getter, so that a call of it runs no code of the page
 * @param {Function} get - Getter from a property descriptor
 * @returns {boolean} True for a getter such as the one of `URL.prototype.href`
 */
function isEngineGetter(get: Function) {
  return get === errorStackGetter || nativeGetterSource.test(functionToString.call(get));
}

/**
 * Read a property the way `obj[key]` does, but do not call a getter of the page
 * @param {Object} obj - Object to inspect
 * @param {string} key - Property key
 * @returns {any} Value of the property, or undefined behind a getter of the page
 */
function readProperty(obj: object | null, key: string) {
  const desc = findDescriptor(obj, key);
  if (!desc?.get) return desc?.value;
  if (isEngineGetter(desc.get)) return desc.get.call(obj);
}

/**
 * Read a property that has to be a string
 * @param {Object} obj - Object to inspect
 * @param {string} key - Property key
 * @returns {string|undefined} Value of the property, if it is a string
 */
function readString(obj: object, key: string) {
  const value = readProperty(obj, key);
  return typeof value === "string" ? value : undefined;
}

/**
 * Format an own property of an object. An accessor prints as a tag: its getter is not called.
 * @param {Object} ctx - Context object
 * @param {Object} holder - Object that has the property
 * @param {string|number} key - Property key
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string|undefined} Formatted property, if the object has it
 */
function formatProperty(ctx: InspectContext, holder: object, key: string | number, recurseTimes: number) {
  const desc = Object.getOwnPropertyDescriptor(holder, key);
  if (!desc) return undefined;
  if (desc.get) return desc.set ? "[Getter/Setter]" : "[Getter]";
  if (desc.set) return "[Setter]";
  return formatValue(ctx, desc.value, recurseTimes);
}

/**
 * Format a string with proper escaping
 * @param {Object} ctx - Context object
 * @param {string} value - String to format
 * @returns {string} Formatted string
 */
function formatString(ctx, value) {
  // Truncate long strings
  if (value.length > ctx.maxStringLength) {
    const remaining = value.length - ctx.maxStringLength;
    const truncated = value.slice(0, ctx.maxStringLength);
    return `'${escape(truncated)}'... ${remaining} more character${remaining > 1 ? "s" : ""}`;
  }
  return `'${escape(value)}'`;
}

/**
 * Escape special characters in a string
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escape(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ch => {
      const code = ch.charCodeAt(0);
      return `\\x${code.toString(16).padStart(2, "0")}`;
    });
}

/**
 * Format a number with optional numeric separators
 * @param {number} value - Number to format
 * @param {boolean} useNumericSeparator - Whether to use numeric separators
 * @returns {string} Formatted number
 */
function formatNumber(value: number, useNumericSeparator: boolean) {
  if (Object.is(value, -0)) return "-0";
  if (!useNumericSeparator) return String(value);

  const str = String(value);
  if (!/^\d+$/.test(str)) return str;

  // Add numeric separators for readability
  return str.replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

/**
 * Format a symbol
 * @param {Symbol} value - Symbol to format
 * @returns {string} Formatted symbol
 */
function formatSymbol(value: symbol) {
  return value.toString();
}

/**
 * Format a function
 * @param {Function} value - Function to format
 * @returns {string} Formatted function
 */
function formatFunction(value: Function) {
  const name = readString(value, "name") || "<anonymous>";
  const constructorName = getConstructorName(Object.getPrototypeOf(value));
  if (constructorName === "AsyncFunction") {
    return `[AsyncFunction: ${name}]`;
  }
  if (constructorName === "GeneratorFunction") {
    return `[GeneratorFunction: ${name}]`;
  }
  if (constructorName === "AsyncGeneratorFunction") {
    return `[AsyncGeneratorFunction: ${name}]`;
  }
  return `[Function: ${name}]`;
}

/**
 * Format an object based on its type
 * @param {Object} ctx - Context object
 * @param {any} value - Object to format
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string} Formatted object
 */
function formatObject(ctx: InspectContext, value: object, recurseTimes: number) {
  // Check recursion depth
  if (recurseTimes >= ctx.depth!) {
    if (Array.isArray(value)) return "[Array]";
    return `[${getConstructorName(value)}]`;
  }

  // Mark as seen to detect circular references
  ctx.seen.push(value);
  recurseTimes += 1;

  let output: string | undefined;

  // Handle special object types
  if (Array.isArray(value)) {
    output = formatArray(ctx, value, recurseTimes);
  } else if (ArrayBuffer.isView(value)) {
    output = formatTypedArray(ctx, value);
  } else {
    switch (getBuiltinKind(value)) {
      case BuiltinKind.Date:
        output = formatDate(value);
        break;
      case BuiltinKind.RegExp:
        output = formatRegExp(value);
        break;
      case BuiltinKind.Error:
        output = formatError(value);
        break;
      case BuiltinKind.Map:
        output = formatMap(ctx, value, recurseTimes);
        break;
      case BuiltinKind.Set:
        output = formatSet(ctx, value, recurseTimes);
        break;
      case BuiltinKind.WeakMap:
        output = "WeakMap { ... }";
        break;
      case BuiltinKind.WeakSet:
        output = "WeakSet { ... }";
        break;
      case BuiltinKind.Promise:
        output = "Promise { ... }";
        break;
      case BuiltinKind.ArrayBuffer:
        output = formatArrayBuffer(ctx, value);
        break;
    }
  }

  // Regular object, or an object that inherits from Date, RegExp or ArrayBuffer but is not one
  output ??= formatPlainObject(ctx, value, recurseTimes);

  // Remove from seen
  ctx.seen.pop();

  return output;
}

/**
 * Find the built-in that an object inherits from
 * @param {Object} value - Object to classify
 * @returns {BuiltinKind} Kind of the first built-in prototype on the prototype chain
 */
function getBuiltinKind(value: object) {
  let proto = Object.getPrototypeOf(value);
  for (let i = 0; proto !== null && i < maxPrototypeChain; i++) {
    const kind = builtinKinds.get(proto);
    if (kind) return kind;
    proto = Object.getPrototypeOf(proto);
  }
  return BuiltinKind.None;
}

/**
 * Apply a captured built-in that reads an internal slot
 * @param {Function} builtin - Built-in method or getter
 * @param {Object} value - Object to read
 * @returns {any} Result, or undefined for an object without the slot (a Proxy, an Object.create of the prototype)
 */
function readSlot<T>(builtin: Builtin<T>, value: object): T | undefined {
  try {
    return builtin.call(value);
  } catch {}
}

/**
 * Format an array
 * @param {Object} ctx - Context object
 * @param {Array} value - Array to format
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string} Formatted array
 */
function formatArray(ctx: InspectContext, value: any[], recurseTimes: number) {
  // Special case for empty arrays
  if (value.length === 0) return "[]";

  const maxLength = Math.min(ctx.maxArrayLength!, value.length);
  const output: string[] = [];

  for (let i = 0; i < maxLength; i++) {
    output.push(formatProperty(ctx, value, i, recurseTimes) ?? "empty");
  }

  // One read, because a Proxy of an array has a trap for it
  const length = value.length;
  if (length > maxLength) {
    const remaining = length - maxLength;
    output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
  }

  // Add array properties that aren't indices
  const keys = Object.keys(value).filter(key => {
    return !(Number(key) >= 0 && Number(key) < length && Number(key) === +key);
  });

  for (const key of keys) {
    try {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      const accessor = desc?.get ? (desc.set ? "[Getter/Setter]" : "[Getter]") : desc?.set ? "[Setter]" : null;
      output.push(`${key}: ${accessor ?? formatValue(ctx, value[key], recurseTimes)}`);
    } catch {
      output.push(`${key}: undefined`);
    }
  }

  return `[ ${output.join(", ")} ]`;
}

/**
 * Format a plain object with property enumeration
 * @param {Object} ctx - Context object
 * @param {Object} value - Object to format
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string} Formatted object
 */
function formatPlainObject(ctx: InspectContext, value: object, recurseTimes: number) {
  // Get constructor name for the prefix
  const constructorName = getConstructorName(value);
  const prefix = constructorName !== "Object" ? `${constructorName} ` : "";

  // Get own and inherited properties
  const keys = getObjectKeys(value, ctx.showHidden);

  if (keys.length === 0) {
    // Handle empty objects
    if (constructorName !== "Object") {
      // If the object has no own properties but has inherited ones
      return formatWithPrototype(ctx, value, recurseTimes, constructorName);
    }
    return `${prefix}{}`;
  }

  // Format properties
  const output: string[] = [];
  for (const key of keys) {
    const formatted = formatProperty(ctx, value, key, recurseTimes);
    if (formatted !== undefined) output.push(`${formatPropertyKey(key)}: ${formatted}`);
  }

  // Sort keys if requested
  if (ctx.sorted) {
    output.sort();
  }

  // Create the final string
  if (output.length === 0) {
    return `${prefix}{}`;
  }

  // Check if it fits on one line
  if (output.join(", ").length < ctx.breakLength!) {
    return `${prefix}{ ${output.join(", ")} }`;
  }

  // Otherwise format with line breaks
  return `${prefix}{\n  ${output.join(",\n  ")}\n}`;
}

/**
 * Format an object by showing its prototype chain properties
 * @param {Object} ctx - Context object
 * @param {Object} value - Object to format
 * @param {number} recurseTimes - Current recursion depth
 * @param {string} constructorName - Constructor name
 * @returns {string} Formatted object with prototype info
 */
function formatWithPrototype(ctx: InspectContext, value: object, recurseTimes: number, constructorName: string) {
  const output: string[] = [];
  const proto = Object.getPrototypeOf(value);
  // Not the getters of a built-in: on an object that only inherits from RegExp.prototype,
  // the `flags` getter reads the other flags with getters of the page.
  if (proto && proto !== Object.prototype && !builtinKinds.has(proto)) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === "constructor" || key === "__proto__") continue;

      // This is `value[key]` without a call of a getter of the page. The fields of a platform
      // object (a URL, a DOMRect) are getters of the prototype that the engine implements.
      // An own property comes first: the `message` of an Error from another realm.
      const desc = Object.getOwnPropertyDescriptor(value, key) ?? Object.getOwnPropertyDescriptor(proto, key)!;
      if (desc.get ? !isEngineGetter(desc.get) : typeof desc.value === "function") continue;

      try {
        const inherited = desc.get ? desc.get.call(value) : desc.value;
        output.push(`${formatPropertyKey(key)}: ${formatValue(ctx, inherited, recurseTimes)}`);
      } catch (err) {
        output.push(`${formatPropertyKey(key)}: undefined`);
      }
    }
  }

  if (ctx.sorted) {
    output.sort();
  }

  if (output.length === 0) {
    return `${constructorName} {}`;
  }

  if (output.join(", ").length < ctx.breakLength!) {
    return `${constructorName} { ${output.join(", ")} }`;
  }

  return `${constructorName} {\n  ${output.join(",\n  ")}\n}`;
}

/**
 * Format a property key with proper quoting if needed
 * @param {string|Symbol} key - Property key
 * @returns {string} Formatted key
 */
function formatPropertyKey(key: string | symbol) {
  if (typeof key === "symbol") {
    return `[${key.toString()}]`;
  }

  if (key === "__proto__") {
    return "['__proto__']";
  }

  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    return key;
  }

  return `'${escape(String(key))}'`;
}

/**
 * Get all relevant keys from an object
 * @param {Object} obj - Object to inspect
 * @param {boolean} showHidden - Whether to include non-enumerable properties
 * @returns {Array} Array of property keys
 */
function getObjectKeys(obj, showHidden) {
  if (showHidden) {
    return Object.getOwnPropertyNames(obj);
  }
  return Object.keys(obj);
}

/**
 * Get constructor name of an object
 * @param {Object} obj - Object to inspect
 * @returns {string} Constructor name
 */
function getConstructorName(obj: object | null) {
  // Most objects are plain. This path reads no descriptor, which the engine allocates.
  if (
    obj !== null &&
    Object.getPrototypeOf(obj) === Object.prototype &&
    !Object.prototype.hasOwnProperty.call(obj, "constructor")
  ) {
    return "Object";
  }

  const constructor = readProperty(obj, "constructor");
  return (typeof constructor === "function" && readString(constructor, "name")) || "Object";
}

/**
 * Format a Date object
 * @param {Object} value - Object that inherits from Date.prototype
 * @returns {string|undefined} Formatted date, or undefined for an object that is not a Date
 */
function formatDate(value: object) {
  const time = readSlot(dateGetTime, value);
  if (time === undefined) return undefined;

  // Check if date is valid
  if (isNaN(time)) {
    return "Invalid Date";
  }
  return `${dateToISOString.call(value)} [Date]`;
}

/**
 * Format a RegExp object
 * @param {Object} value - Object that inherits from RegExp.prototype
 * @returns {string|undefined} Formatted regexp, or undefined for an object that is not a RegExp
 */
function formatRegExp(value: object) {
  const source = readSlot(regExpSource, value);
  if (source === undefined) return undefined;

  let flags = "";
  for (let i = 0; i < regExpFlagGetters.length; i++) {
    if (regExpFlagGetters[i].call(value)) flags += regExpFlags[i];
  }
  return `/${source}/${flags}`;
}

/**
 * Format an Error object
 * @param {Object} value - Object that inherits from Error.prototype
 * @returns {string} Formatted error
 */
function formatError(value: object) {
  const stack = readString(value, "stack");
  if (stack) return stack;

  // The text that Error.prototype.toString returns. That method calls getters of the page.
  const name = readString(value, "name") ?? "Error";
  const message = readString(value, "message") ?? "";
  return name && message ? `${name}: ${message}` : name || message;
}

/**
 * Format a Map object
 * @param {Object} ctx - Context object
 * @param {Map} value - Map to format
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string} Formatted map
 */
function formatMap(ctx: InspectContext, value: object, recurseTimes: number) {
  const size = readSlot(mapSize, value);
  // Only code of the page can read the entries of a Proxy of a Map
  if (size === undefined) return "Map { [entries not read] }";

  const output: string[] = [];
  const entries = mapEntries.call(value);
  let i = 0;

  for (let entry = mapIteratorNext.call(entries); !entry.done; entry = mapIteratorNext.call(entries)) {
    if (i >= ctx.maxArrayLength!) {
      const remaining = size - ctx.maxArrayLength!;
      output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
      break;
    }

    const pair = entry.value;
    output.push(`${formatValue(ctx, pair[0], recurseTimes)} => ${formatValue(ctx, pair[1], recurseTimes)}`);
    i++;
  }

  if (output.length === 0) {
    return "Map {}";
  }

  const joined = output.join(", ");

  if (joined.length < ctx.breakLength!) {
    return `Map { ${joined} }`;
  }

  return `Map {\n  ${output.join(",\n  ")}\n}`;
}

/**
 * Format a Set object
 * @param {Object} ctx - Context object
 * @param {Set} value - Set to format
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string} Formatted set
 */
function formatSet(ctx: InspectContext, value: object, recurseTimes: number) {
  const size = readSlot(setSize, value);
  // Only code of the page can read the entries of a Proxy of a Set
  if (size === undefined) return "Set { [entries not read] }";

  const output: string[] = [];
  const values = setValues.call(value);
  let i = 0;
  const max = ctx.maxArrayLength!;

  for (let entry = setIteratorNext.call(values); !entry.done; entry = setIteratorNext.call(values)) {
    if (i >= max) {
      const remaining = size - max;
      output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
      break;
    }

    output.push(formatValue(ctx, entry.value, recurseTimes));
    i++;
  }

  if (output.length === 0) {
    return "Set {}";
  }

  if (output.join(", ").length < ctx.breakLength!) {
    return `Set { ${output.join(", ")} }`;
  }

  return `Set {\n  ${output.join(",\n  ")}\n}`;
}

/**
 * Format a typed array
 * @param {Object} ctx - Context object
 * @param {TypedArray} value - Typed array to format
 * @returns {string} Formatted typed array
 */
function formatTypedArray(ctx: InspectContext, value: ArrayBufferView) {
  const name = getConstructorName(value);
  // A DataView has no elements
  const length = readSlot(typedArrayLength, value) ?? 0;
  const maxLength = Math.min(ctx.maxArrayLength!, length);
  const output: string[] = [];

  for (let i = 0; i < maxLength; i++) {
    output.push(String(value[i]));
  }

  if (length > maxLength) {
    const remaining = length - maxLength;
    output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
  }

  return `${name} [ ${output.join(", ")} ]`;
}

/**
 * Format an ArrayBuffer
 * @param {Object} ctx - Context object
 * @param {Object} value - Object that inherits from ArrayBuffer.prototype
 * @returns {string|undefined} Formatted array buffer, or undefined for an object that is not an ArrayBuffer
 */
function formatArrayBuffer(ctx: InspectContext, value: object) {
  // `new Uint8Array` iterates an object that is not an ArrayBuffer
  if (readSlot(arrayBufferByteLength, value) === undefined) return undefined;

  const constructorName = getConstructorName(value);
  let bytes;
  try {
    bytes = new Uint8Array(value as ArrayBuffer);
  } catch {
    return `${constructorName} { [Detached] }`;
  }

  const byteLength = bytes.byteLength;
  const maxLength = Math.min(ctx.maxArrayLength!, byteLength);
  const output: string[] = [];

  for (let i = 0; i < maxLength; i++) {
    output.push(bytes[i].toString(16).padStart(2, "0"));
  }

  if (byteLength > maxLength) {
    const remaining = byteLength - maxLength;
    output.push(`... ${remaining} more byte${remaining > 1 ? "s" : ""}`);
  }

  return `${constructorName} { ${output.join(" ")} }`;
}
