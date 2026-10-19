// The JS half of node's `[nodejs.util.inspect.custom]` methods. WebStreamsInspectCustom.cpp calls it with native state.

const { inspect, formatWithOptions, getCtxStyle } = require("internal/util/inspect");
const { uncurryThis, SafeWeakMap } = require("internal/primordials");

const NumberIsFinite = Number.isFinite;
const NumberIsInteger = Number.isInteger;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectKeys = Object.keys;
const ObjectPrototypeHasOwnProperty = uncurryThis(Object.prototype.hasOwnProperty);
const ObjectPrototypePropertyIsEnumerable = uncurryThis(Object.prototype.propertyIsEnumerable);
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ReflectOwnKeys = Reflect.ownKeys;
const StringPrototypeIncludes = uncurryThis(String.prototype.includes);
const StringPrototypeIndexOf = uncurryThis(String.prototype.indexOf);
const StringPrototypeSlice = uncurryThis(String.prototype.slice);
const SymbolToStringTag = Symbol.toStringTag;
const customInspectSymbol = Symbol.for("nodejs.util.inspect.custom");

// The names that node's method reads from `this`, in its order.
const kResponse = ["status", "statusText", "headers", "body", "bodyUsed", "ok", "redirected", "type", "url"];
const kRequest = [
  "method",
  "url",
  "headers",
  "destination",
  "referrer",
  "referrerPolicy",
  "mode",
  "credentials",
  "cache",
  "redirect",
  "integrity",
  "keepalive",
  "isReloadNavigation",
  "isHistoryNavigation",
  "signal",
];
const kBlob = ["size", "type"];
const kAbortSignal = ["aborted"];
const kAbortController = ["signal"];
const kTextDecoder = ["encoding", "fatal", "ignoreBOM"];

// A data property with one of `names` between the receiver and the class is the field. An accessor is not called.
function stateOf(names: string[], holder, fields: object) {
  const state = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let own;
    for (let object = holder; object && !$isProxyObject(object); object = ObjectGetPrototypeOf(object)) {
      own = ObjectGetOwnPropertyDescriptor(object, name);
      if (own !== undefined) break;
    }
    if (own !== undefined && ObjectPrototypeHasOwnProperty(own, "value")) {
      $putByValDirect(state, name, own.value);
    } else if (ObjectPrototypeHasOwnProperty(fields, name)) {
      $putByValDirect(state, name, fields[name]);
    }
  }
  const rest = ObjectKeys(fields);
  for (let i = 0; i < rest.length; i++) {
    if (!ObjectPrototypeHasOwnProperty(state, rest[i])) $putByValDirect(state, rest[i], fields[rest[i]]);
  }
  return state;
}

// Each method starts a new `inspect`, so the values being printed travel in an option that `inspect` passes on.
const kPrinting = "[[inspect_hooks.printing]]";
const numbers = new SafeWeakMap();
let lastNumber = 0;
function numberOf(instance: object): string {
  let number = numbers.get(instance);
  if (number === undefined) numbers.set(instance, (number = ++lastNumber));
  return `,${number},`;
}
function isPrinting(options, instance: object) {
  const printing = options?.[kPrinting];
  return typeof printing === "string" && StringPrototypeIncludes(printing, numberOf(instance));
}
function printingWith(options, instance: object) {
  const printing = options?.[kPrinting];
  const number = numberOf(instance);
  return typeof printing === "string" ? `${printing}${StringPrototypeSlice(number, 1)}` : number;
}

function special(options, text: string) {
  return typeof options?.stylize === "function" ? options.stylize(text, "special") : text;
}

// node's getConstructorOf (lib/internal/util.js), ending at a Proxy.
function getConstructorOf(object) {
  while (object && !$isProxyObject(object)) {
    const descriptor = ObjectGetOwnPropertyDescriptor(object, "constructor");
    if (descriptor !== undefined && typeof descriptor.value === "function" && descriptor.value.name !== "") {
      return descriptor.value;
    }
    object = ObjectGetPrototypeOf(object);
  }
  return null;
}

function isInstanceof(object, constructor) {
  try {
    return object instanceof constructor;
  } catch {
    return false;
  }
}

// formatRaw's `[Name]`. node returns `this` there, and its value has own keys where Bun's has none.
function pastDepthLimit(self, options, holder, instance, tag: string, method) {
  if (holder !== instance) return self;
  let constructor: Function | null = null;
  let constructorOwner;
  let tagOwner;
  // The prototype that has the method: Blob.prototype, for a Blob and for a File.
  let methodOwner;
  let object = holder;
  for (; object && !$isProxyObject(object); object = ObjectGetPrototypeOf(object)) {
    tagOwner ??= ObjectPrototypeHasOwnProperty(object, SymbolToStringTag) ? object : undefined;
    if (constructor === null) {
      const descriptor = ObjectGetOwnPropertyDescriptor(object, "constructor");
      const value = descriptor !== undefined ? descriptor.value : undefined;
      if (typeof value === "function" && value.name !== "" && isInstanceof(holder, value)) {
        constructor = value;
        constructorOwner = object;
      }
    }
    if (tag === "File" && methodOwner === undefined) {
      const descriptor = ObjectGetOwnPropertyDescriptor(object, customInspectSymbol);
      if (descriptor !== undefined && descriptor.value === method) methodOwner = object;
    } else if (constructor !== null && tagOwner !== undefined) {
      break;
    }
  }
  let toStringTag = holder[SymbolToStringTag];
  if (
    typeof toStringTag !== "string" ||
    (tagOwner === holder && (options?.showHidden || ObjectPrototypePropertyIsEnumerable(holder, SymbolToStringTag)))
  ) {
    toStringTag = "";
  }
  // The search does not look behind a Proxy: a value with such a prototype is an Object.
  let name = constructor !== null ? String(constructor.name) : object ? "Object" : null;
  // A File has Blob.prototype, whose constructor and tag say Blob.
  if (tag === "File" && methodOwner !== undefined) {
    if (constructorOwner === methodOwner) name = tag;
    if (toStringTag === "Blob" && tagOwner === methodOwner) toStringTag = tag;
  }
  const text = StringPrototypeSlice(getCtxStyle(holder, name, toStringTag), 0, -1);
  return special(options, name === null ? text : `[${text}]`);
}

// node's method for a ReadableStream (lib/internal/webstreams/util.js), over the state of a Response's body.
function bodyStream(fields: object) {
  return {
    [customInspectSymbol](depth, options) {
      // What the stream's own method gives there. node's gives `undefined`.
      if (depth < 0) return "ReadableStream {}";
      return `ReadableStream ${inspect(fields, {
        ...options,
        depth: options.depth == null ? null : options.depth - 1,
      })}`;
    },
  };
}

function withoutInstance(tag: string, self, options) {
  switch (tag) {
    // node's method has no check of its receiver: it prints it one level deep.
    case "Timeout":
      return inspect(self, { ...options, depth: 0, customInspect: false });
    case "Headers":
    case "FormData":
    case "Event":
    case "TextDecoder":
      throw $ERR_INVALID_THIS(tag);
  }
  // node prints undefined fields or throws here. The receiver comes back and prints as the object it is.
  if (self == null) throw $ERR_INVALID_THIS(tag);
  return self;
}

function inspectHook(tag: string, self, depth, options, fields, holder, instance, method) {
  // node's method for a timer prints own properties, so an object that inherits from a timer is not the timer.
  if (fields === undefined || (tag === "Timeout" && holder !== instance)) return withoutInstance(tag, self, options);

  switch (tag) {
    // undici v8.3.0 lib/web/fetch/response.js#L255 and request.js#L797: the depth that it got is kept.
    case "Response":
    case "Request": {
      if (isPrinting(options, instance)) return special(options, "[Circular]");
      if (options.depth === null) options.depth = 2;
      options.colors ??= true;
      if (ObjectPrototypeHasOwnProperty(fields, "body") && fields.body !== null) {
        $putByValDirect(fields, "body", bodyStream(fields.body));
      }
      const state = stateOf(tag === "Response" ? kResponse : kRequest, holder, fields);
      // formatWithOptions has undici's error for options that are a function.
      if (typeof options === "function") return `${tag} ${formatWithOptions(options, state)}`;
      const childOptions = { ...options, [kPrinting]: printingWith(options, instance) };
      // With colors, `inspect` makes its own `stylize`. The one in the options must not reach the nested methods.
      if (childOptions.colors) delete childOptions.stylize;
      return `${tag} ${formatWithOptions(childOptions, state)}`;
    }

    // undici v8.3.0 lib/web/fetch/headers.js#L627
    case "Headers":
      options.depth ??= depth;
      return `Headers ${formatWithOptions(options, fields)}`;

    // undici v8.3.0 lib/web/fetch/formdata.js#L163. `fields` is the flat list name, value, name, value.
    case "FormData": {
      const state = { __proto__: null };
      for (let i = 0; i < fields.length; i += 2) {
        const name = fields[i];
        const value = fields[i + 1];
        const held = state[name];
        if (!held) {
          state[name] = value;
        } else if ($isJSArray(held)) {
          $putByValDirect(held, held.length, value);
        } else {
          state[name] = [held, value];
        }
      }
      options.depth ??= depth;
      options.colors ??= true;
      // The prefix of an object with no prototype takes part in the line breaks, then goes.
      const output = formatWithOptions(options, state);
      return `FormData ${StringPrototypeSlice(output, StringPrototypeIndexOf(output, "]") + 2)}`;
    }

    // node v26.3.0 lib/internal/blob.js#L182 and file.js#L99
    case "Blob":
    case "File": {
      if (depth < 0) return pastDepthLimit(self, options, holder, instance, tag, method);
      if (isPrinting(options, instance)) return special(options, "[Circular]");
      const childOptions = { ...options, depth: options.depth == null ? null : options.depth - 1 };
      if (!NumberIsFinite(childOptions.depth)) childOptions[kPrinting] = printingWith(options, instance);
      return `${tag} ${inspect(stateOf(kBlob, holder, fields), childOptions)}`;
    }

    // node v26.3.0 lib/internal/abort_controller.js#L124
    case "AbortSignal":
    case "AbortController": {
      if (depth < 0) {
        // node returns `this`. Its AbortController has no own key and prints as `AbortController {}`.
        return tag === "AbortSignal" ? pastDepthLimit(self, options, holder, instance, tag, method) : self;
      }
      if (isPrinting(options, instance)) return special(options, "[Circular]");
      const childOptions = { ...options, depth: options.depth === null ? null : options.depth - 1 };
      if (!NumberIsFinite(childOptions.depth)) childOptions[kPrinting] = printingWith(options, instance);
      const names = tag === "AbortSignal" ? kAbortSignal : kAbortController;
      return `${holder.constructor.name} ${inspect(stateOf(names, holder, fields), childOptions)}`;
    }

    // node v26.3.0 lib/internal/event_target.js#L151
    case "Event": {
      const name = holder.constructor.name;
      if (depth < 0) return name;
      return `${name} ${inspect(fields, {
        ...options,
        depth: NumberIsInteger(options.depth) ? options.depth - 1 : options.depth,
      })}`;
    }

    // node v26.3.0 lib/internal/encoding.js#L581: the fields print with the default options.
    case "TextDecoder": {
      if (typeof depth === "number" && depth < 0) return pastDepthLimit(self, options, holder, instance, tag, method);
      if (isPrinting(options, instance)) return special(options, "[Circular]");
      const constructor = getConstructorOf(holder);
      return `${constructor === null ? tag : constructor.name} ${inspect(stateOf(kTextDecoder, holder, fields), {
        [kPrinting]: printingWith(options, instance),
      })}`;
    }

    // node v26.3.0 lib/internal/timers.js#L224 prints the timer. This prints a stand-in with its prototype and properties.
    case "Timeout": {
      const state = ObjectCreate(ObjectGetPrototypeOf(instance));
      const names = ObjectKeys(fields);
      for (let i = 0; i < names.length; i++) $putByValDirect(state, names[i], fields[names[i]]);
      const keys = ReflectOwnKeys(instance);
      for (let i = 0; i < keys.length; i++) {
        const own = ObjectSetPrototypeOf(ObjectGetOwnPropertyDescriptor(instance, keys[i]), null);
        if (own.value === instance) own.value = state;
        // With `getters: true`, a getter of the timer runs on the timer.
        const get = own.get;
        if (get !== undefined) own.get = () => get.$call(instance);
        ObjectDefineProperty(state, keys[i], own);
      }
      return inspect(state, { ...options, depth: 0, customInspect: false });
    }
  }
}

export default inspectHook;
