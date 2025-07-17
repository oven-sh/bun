/* This file provides utilities for inspecting and formatting JavaScript values in client-side code.
 * It implements a Node.js-like `inspect` function that converts any JavaScript value
 * into a string representation, handling circular references, various object types,
 * and respecting customization options.
 *
 * The implementation supports:
 * - Primitive values (strings, numbers, booleans, etc.)
 * - Complex objects and arrays with customizable depth
 * - Special handling for typed arrays, Sets, Maps, and ArrayBuffers
 * - Custom inspection via Symbol.for("nodejs.util.inspect.custom")
 * - Configurable output formatting (indentation, truncation, etc.)
 *
 * This is mostly intended for pretty printing console.log from browser to CLI.
 */

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

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
  customInspect?: boolean;
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
  customInspect: true,
} as const;

/**
 * Main inspection function
 * @param {any} obj - Object to inspect
 * @param {Object} options - Configuration options
 * @returns {string} String representation
 */
export function inspect(obj: any, options: InspectOptions = {}) {
  // Set up context with merged options
  const ctx: InspectContext = {
    seen: [],
    currentDepth: 0,
    ...defaultOptions,
    ...options,
  } as InspectContext;

  return formatValue(ctx, obj, 0);
}

/**
 * Format a value based on its type
 * @param {Object} ctx - Context object with settings
 * @param {any} value - Value to format
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string} Formatted value
 */
function formatValue(ctx: InspectContext, value: any, recurseTimes: number) {
  // Handle primitive types
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  // Check for custom inspect implementation
  if (
    ctx.customInspect !== false &&
    value !== null &&
    typeof value === "object" &&
    typeof value[inspectSymbol] === "function" &&
    value[inspectSymbol] !== inspect
  ) {
    return String(value[inspectSymbol](recurseTimes, { ...ctx }));
  }

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
      return formatFunction(value);
    case "object":
      return formatObject(ctx, value, recurseTimes);
    default:
      return String(value);
  }
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
  const name = value.name || "<anonymous>";
  const constructorName = Object.getPrototypeOf(value)?.constructor?.name;
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
function formatObject(ctx: InspectContext, value: any, recurseTimes: number) {
  // Check recursion depth
  if (recurseTimes >= ctx.depth!) {
    if (Array.isArray(value)) return "[Array]";
    return `[${getConstructorName(value)}]`;
  }

  // Mark as seen to detect circular references
  ctx.seen.push(value);
  recurseTimes += 1;

  let output;

  // Handle special object types
  if (Array.isArray(value)) {
    output = formatArray(ctx, value, recurseTimes);
  } else if (value instanceof Date) {
    output = formatDate(value);
  } else if (value instanceof RegExp) {
    output = formatRegExp(value);
  } else if (value instanceof Error) {
    output = formatError(value);
  } else if (value instanceof Map) {
    output = formatMap(ctx, value, recurseTimes);
  } else if (value instanceof Set) {
    output = formatSet(ctx, value, recurseTimes);
  } else if (value instanceof WeakMap) {
    output = "WeakMap { ... }";
  } else if (value instanceof WeakSet) {
    output = "WeakSet { ... }";
  } else if (value instanceof Promise) {
    output = "Promise { ... }";
  } else if (ArrayBuffer.isView(value)) {
    output = formatTypedArray(ctx, value as ArrayBufferView & { length: number });
  } else if (value instanceof ArrayBuffer) {
    output = formatArrayBuffer(ctx, value);
  } else {
    // Regular object
    output = formatPlainObject(ctx, value, recurseTimes);
  }

  // Remove from seen
  ctx.seen.pop();

  return output;
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
    if (Object.prototype.hasOwnProperty.call(value, i)) {
      output.push(formatValue(ctx, value[i], recurseTimes));
    } else {
      output.push("empty");
    }
  }

  if (value.length > maxLength) {
    const remaining = value.length - maxLength;
    output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
  }

  // Add array properties that aren't indices
  const keys = Object.keys(value).filter(key => {
    return !(Number(key) >= 0 && Number(key) < value.length && Number(key) === +key);
  });

  if (keys.length > 0) {
    for (const key of keys) {
      output.push(`${key}: ${formatValue(ctx, value[key], recurseTimes)}`);
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
function formatPlainObject(ctx: InspectContext, value: any, recurseTimes: number) {
  // Get constructor name for the prefix
  const constructorName = getConstructorName(value);
  const prefix = constructorName !== "Object" ? `${constructorName} ` : "";

  // Get own and inherited properties
  const keys = getObjectKeys(value, ctx.showHidden);

  if (keys.length === 0) {
    // Handle empty objects
    if (constructorName !== "Object" && getPrototypeKeys(value).length > 0) {
      // If the object has no own properties but has inherited ones
      return formatWithPrototype(ctx, value, recurseTimes, constructorName);
    }
    return `${prefix}{}`;
  }

  // Format properties
  const output: string[] = [];
  for (const key of keys) {
    try {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (desc) {
        if (desc.get || desc.set) {
          if (desc.get && desc.set) {
            output.push(`${formatPropertyKey(key)}: [Getter/Setter]`);
          } else if (desc.get) {
            output.push(`${formatPropertyKey(key)}: [Getter]`);
          } else {
            output.push(`${formatPropertyKey(key)}: [Setter]`);
          }
        } else {
          output.push(`${formatPropertyKey(key)}: ${formatValue(ctx, value[key], recurseTimes)}`);
        }
      }
    } catch (err) {
      output.push(`${formatPropertyKey(key)}: undefined`);
    }
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
function formatWithPrototype(ctx: InspectContext, value: any, recurseTimes: number, constructorName: string) {
  const protoKeys = getPrototypeKeys(value);

  if (protoKeys.length === 0) {
    return `${constructorName} {}`;
  }

  const output: string[] = [];
  for (const key of protoKeys) {
    try {
      // Add prototype prefix to distinguish from own properties
      output.push(`${formatPropertyKey(key)}: ${formatValue(ctx, value[key], recurseTimes)}`);
    } catch (err) {
      output.push(`${formatPropertyKey(key)}: undefined`);
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
 * Get keys from an object's prototype
 * @param {Object} obj - Object to inspect
 * @returns {Array} Array of prototype keys
 */
function getPrototypeKeys(obj) {
  const proto = Object.getPrototypeOf(obj);
  if (!proto || proto === Object.prototype) {
    return [];
  }

  const protoKeys = Object.getOwnPropertyNames(proto).filter(key => {
    if (key === "constructor") return false;

    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    return typeof descriptor?.value !== "function" && key !== "__proto__";
  });

  return protoKeys;
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
function getConstructorName(obj: any) {
  if (!obj || typeof obj !== "object") {
    return "";
  }

  let constructorName = obj.constructor?.name;
  if (!constructorName) {
    const prototype = Object.getPrototypeOf(obj);
    const protoName = prototype?.constructor?.name;
    if (protoName) {
      constructorName = protoName;
    }
  }

  return constructorName || "Object";
}

/**
 * Format a Date object
 * @param {Date} value - Date to format
 * @returns {string} Formatted date
 */
function formatDate(value) {
  // Check if date is valid
  if (isNaN(value.getTime())) {
    return "Invalid Date";
  }
  return `${value.toISOString()} [Date]`;
}

/**
 * Format a RegExp object
 * @param {RegExp} value - RegExp to format
 * @returns {string} Formatted regexp
 */
function formatRegExp(value) {
  return String(value);
}

/**
 * Format an Error object
 * @param {Error} value - Error to format
 * @returns {string} Formatted error
 */
function formatError(value: Error) {
  return value?.stack || value + "";
}

/**
 * Format a Map object
 * @param {Object} ctx - Context object
 * @param {Map} value - Map to format
 * @param {number} recurseTimes - Current recursion depth
 * @returns {string} Formatted map
 */
function formatMap(ctx: InspectContext, value: Map<any, any>, recurseTimes: number) {
  const output: string[] = [];
  const size = value.size;
  let i = 0;

  for (const [k, v] of value) {
    if (i >= ctx.maxArrayLength!) {
      const remaining = size - ctx.maxArrayLength!;
      output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
      break;
    }

    output.push(`${formatValue(ctx, k, recurseTimes)} => ${formatValue(ctx, v, recurseTimes)}`);
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
function formatSet(ctx: InspectContext, value: Set<any>, recurseTimes: number) {
  const output: string[] = [];
  const size = value.size;
  let i = 0;
  const max = ctx.maxArrayLength!;

  for (const v of value) {
    if (i >= max) {
      const remaining = size - max;
      output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
      break;
    }

    output.push(formatValue(ctx, v, recurseTimes));
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
function formatTypedArray(ctx: InspectContext, value: ArrayBufferView & { length: number }) {
  const name = value.constructor.name;
  const length = value.length;
  const maxLength = Math.min(ctx.maxArrayLength!, length);
  const output: string[] = [];

  for (let i = 0; i < maxLength; i++) {
    output.push(String(value[i]));
  }

  if (value.length > maxLength) {
    const remaining = value.length - maxLength;
    output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
  }

  return `${name} [ ${output.join(", ")} ]`;
}

/**
 * Format an ArrayBuffer
 * @param {Object} ctx - Context object
 * @param {ArrayBuffer} value - ArrayBuffer to format
 * @returns {string} Formatted array buffer
 */
function formatArrayBuffer(ctx: InspectContext, value: ArrayBuffer) {
  const constructorName = getConstructorName(value);
  let bytes;
  try {
    bytes = new Uint8Array(value);
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
