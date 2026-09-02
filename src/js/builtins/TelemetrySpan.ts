// Prototype methods of Bun.otel / @opentelemetry/api spans (JSTelemetrySpan).
//
// A JS-owned span keeps everything in its internal fields until end(), which
// hands it all to native code at once; nothing here calls into native unless
// the span is native-owned (e.g. a Bun.serve request span), whose state lives
// in a native slot and is reached through the $telemetry* private functions
// (JSTelemetrySpan.cpp).

// JSTelemetrySpan::Field (src/jsc/bindings/JSTelemetrySpan.h).
const enum Field {
  State = 0,
  Attributes = 1,
  Name = 2,
  Events = 3,
  Links = 4,
  StatusCode = 5,
  StatusMessage = 6,
  AttributeIndex = 11,
}

// JSTelemetrySpan::State
const enum State {
  Recording = 1,
  Ended = 2,
  Native = 4,
}

// Loose bound on what a JS-owned span buffers (TelemetryABI.h
// kTelemetryMaxGather); the configured limits are lower and applied natively.
const enum MaxBuffered {
  LinkValues = 16384,
}

// Fewer buffered attribute elements (2 per key) than this: a repeated key is
// found by a scan. From this many on: by Field.AttributeIndex (JSTelemetrySpan.cpp
// kAttributeIndexFrom). 32 keys is about where the scan stops beating a Map
// lookup; below it the Map would only add an allocation per span.
const enum Attributes {
  IndexFrom = 64,
}

export function setAttribute(this: unknown, key: unknown, value: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, Field.State) as number;
  if (!(state & State.Recording) || value == null) return this;
  key = key + "";
  if (state & State.Native) {
    $telemetrySetAttribute(this, key, value);
    return this;
  }
  const attrs = $getInternalField(this, Field.Attributes) as unknown[] | null;
  if (attrs === null) {
    $putInternalField(this, Field.Attributes, [key, value]);
    return this;
  }
  // Keys stay unique: a repeated key overwrites in place.
  const n = attrs.length;
  if (n >= Attributes.IndexFrom) {
    $telemetrySpanSetAttributeIndexed(this, attrs, key, value);
    return this;
  }
  for (let i = 0; i < n; i += 2) {
    if (attrs[i] === key) {
      attrs[i + 1] = value;
      return this;
    }
  }
  $arrayPush(attrs, key);
  $arrayPush(attrs, value);
  return this;
}

// setAttribute once the span buffers Attributes.IndexFrom elements: the key's
// position comes from a key → index Map kept beside the flat array, so n
// distinct keys cost O(n), not O(n²) compares. Built on first use from the
// (unique) keys already buffered; whoever appends from then on keeps it whole.
$visibility = "Private";
export function telemetrySpanSetAttributeIndexed(span: any, attrs: unknown[], key: string, value: unknown) {
  let index = $getInternalField(span, Field.AttributeIndex) as Map<unknown, number> | null;
  if (index === null) {
    index = new $Map();
    const n = attrs.length;
    for (let i = 0; i < n; i += 2) index.$set(attrs[i], i);
    $putInternalField(span, Field.AttributeIndex, index);
  }
  const at = index.$get(key);
  if (at !== undefined) {
    attrs[at + 1] = value;
    return;
  }
  index.$set(key, attrs.length);
  $arrayPush(attrs, key);
  $arrayPush(attrs, value);
}

// = setAttribute without the brand check, for the builtins below (setAttributes, fail).
// setAttribute and set keep their own inlined copy: they are the per-attribute hot path.
$visibility = "Private";
export function telemetrySpanSetAttributeImpl(span: any, key: unknown, value: unknown) {
  const state = $getInternalField(span, Field.State) as number;
  if (!(state & State.Recording) || value == null) return span;
  key = key + "";
  if (state & State.Native) {
    $telemetrySetAttribute(span, key as string, value);
    return span;
  }
  const attrs = $getInternalField(span, Field.Attributes) as unknown[] | null;
  if (attrs === null) {
    $putInternalField(span, Field.Attributes, [key, value]);
    return span;
  }
  const n = attrs.length;
  if (n >= Attributes.IndexFrom) {
    $telemetrySpanSetAttributeIndexed(span, attrs, key as string, value);
    return span;
  }
  for (let i = 0; i < n; i += 2) {
    if (attrs[i] === key) {
      attrs[i + 1] = value;
      return span;
    }
  }
  $arrayPush(attrs, key);
  $arrayPush(attrs, value);
  return span;
}

export function setAttributes(this: unknown, attributes: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  return $telemetrySpanSetAttributesImpl(this, attributes);
}

$visibility = "Private";
export function telemetrySpanSetAttributesImpl(span: any, attributes: unknown) {
  const state = $getInternalField(span, Field.State) as number;
  if (!(state & State.Recording) || attributes == null || typeof attributes !== "object") return span;
  if (state & State.Native) {
    if (!$telemetrySetAttributes(span, attributes as object, null))
      $telemetrySetAttributes(span, null, $telemetryFlattenAttributes(attributes));
    return span;
  }
  const keys = Object.keys(attributes as object);
  for (let k = 0; k < keys.length; k++) $telemetrySpanSetAttributeImpl(span, keys[k], attributes[keys[k]]);
  return span;
}

export function updateName(this: unknown, name: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, Field.State) as number;
  if (!(state & State.Recording)) return this;
  name = name + "";
  if (state & State.Native) $telemetrySetName(this, name);
  else $putInternalField(this, Field.Name, name);
  return this;
}

export function isRecording(this: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  return (($getInternalField(this, Field.State) as number) & State.Recording) !== 0;
}

// setStatus({ code, message }) — or setStatus(code, message?)
export function setStatus(this: unknown, status: any, messageArg?: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  return $telemetrySpanSetStatusImpl(this, status, messageArg);
}

$visibility = "Private";
export function telemetrySpanSetStatusImpl(span: any, status: any, messageArg?: unknown) {
  const state = $getInternalField(span, Field.State) as number;
  if (!(state & State.Recording) || status == null) return span;
  // api SpanStatusCode: UNSET 0, OK 1, ERROR 2 — or "unset" | "ok" | "error"
  let code: number, msg: unknown;
  if (typeof status === "number") {
    code = status | 0;
    msg = messageArg;
  } else if (typeof status === "string") {
    code = status === "error" ? 2 : status === "ok" ? 1 : 0;
    msg = messageArg;
  } else {
    code = status.code | 0;
    msg = status.message;
  }
  if (code !== 1 && code !== 2) return span;
  const message = code === 2 && msg != null ? msg + "" : "";
  if (state & State.Native) {
    $telemetrySetStatus(span, code, message);
    return span;
  }
  // OK is final.
  if (($getInternalField(span, Field.StatusCode) as number) === 1) return span;
  $putInternalField(span, Field.StatusCode, code);
  $putInternalField(span, Field.StatusMessage, message);
  return span;
}

// addEvent(name, attributesOrStartTime?, startTime?)
export function addEvent(this: unknown, name: unknown, a?: unknown, b?: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, Field.State) as number;
  if (!(state & State.Recording)) return this;
  let attributes: unknown, time: unknown;
  if (typeof a === "number" || $isJSArray(a) || a instanceof Date) {
    time = a;
  } else {
    attributes = a;
    time = b;
  }
  const flat = $telemetryFlattenAttributes(attributes);
  $telemetryAddEvent(this, name + "", flat, time);
  return this;
}

// set(key, value) — or set({ ...attributes })
export function set(this: any, keyOrAttributes: unknown, value?: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  if (typeof keyOrAttributes !== "string") return $telemetrySpanSetAttributesImpl(this, keyOrAttributes);
  // = setAttribute, inlined
  const state = $getInternalField(this, Field.State) as number;
  if (!(state & State.Recording) || value == null) return this;
  if (state & State.Native) {
    $telemetrySetAttribute(this, keyOrAttributes, value);
    return this;
  }
  const attrs = $getInternalField(this, Field.Attributes) as unknown[] | null;
  if (attrs === null) {
    $putInternalField(this, Field.Attributes, [keyOrAttributes, value]);
    return this;
  }
  const n = attrs.length;
  if (n >= Attributes.IndexFrom) {
    $telemetrySpanSetAttributeIndexed(this, attrs, keyOrAttributes, value);
    return this;
  }
  for (let i = 0; i < n; i += 2) {
    if (attrs[i] === keyOrAttributes) {
      attrs[i + 1] = value;
      return this;
    }
  }
  $arrayPush(attrs, keyOrAttributes);
  $arrayPush(attrs, value);
  return this;
}

// The one rule for `exception.type` / `error.type` of a thrown value (also used by
// node:http and mirrored by telemetryFailSpanNoJS in JSTelemetrySpan.cpp): a non-empty
// string `code` (node style; a DOMException's numeric code is not one), else a non-empty
// string `name`, else "Error". Primitives have no type.
$visibility = "Private";
export function telemetryErrorType(error: unknown): string | undefined {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) return undefined;
  const code = (error as any).code;
  if (typeof code === "string" && code !== "") return code;
  const name = (error as any).name;
  if (typeof name === "string" && name !== "") return name;
  return "Error";
}

// fail(error) — record the exception and mark the span failed with its message;
// the same attributes/status/event as a throw out of `Bun.otel.span(name, fn)`.
export function fail(this: any, error: any) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, Field.State) as number;
  if (!(state & State.Recording)) return this;
  $telemetrySpanRecordExceptionImpl(this, error, undefined);
  if (error != null) $telemetrySpanSetAttributeImpl(this, "error.type", $telemetryErrorType(error) ?? "Error");
  const message =
    error == null || typeof error === "symbol"
      ? undefined
      : typeof error === "object" || typeof error === "function"
        ? error.message
        : error + "";
  return $telemetrySpanSetStatusImpl(this, 2, message);
}

export function ok(this: any) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  return $telemetrySpanSetStatusImpl(this, 1);
}

export function recordException(this: any, exception: any, time?: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  return $telemetrySpanRecordExceptionImpl(this, exception, time);
}

// Bun.otel.span(name, fn) / Bun.otel.wrap returned a promise: the span ends
// when it settles (failed on rejection), and the caller gets the derived
// promise, so a rejection the caller does not handle is still reported as
// unhandled (node's tracePromise shape).
$visibility = "Private";
export function telemetryTraceSettled(span: any, promise: Promise<unknown>) {
  return promise.$then(
    value => {
      $telemetrySpanEnd(span);
      return value;
    },
    error => {
      $telemetrySpanFailNoJS(span, error);
      $telemetrySpanEnd(span);
      throw error;
    },
  );
}

// A promise whose settlement ends `span` but which nobody receives from us
// (an async ServerWebSocket handler's return value): end / fail the span and do
// not manufacture a second rejected promise. Observing marks `promise` handled
// in JSC, so a rejection nobody else had handled when we attached is reported
// against `promise` itself, as it would have been without telemetry.
$visibility = "Private";
export function telemetryObserveSettled(span: any, promise: Promise<unknown>, wasHandled: boolean) {
  promise.$then(
    () => {
      $telemetrySpanEnd(span);
    },
    error => {
      $telemetrySpanFailNoJS(span, error);
      $telemetrySpanEnd(span);
      if (!wasHandled) $telemetryReportUnhandled(promise, error);
    },
  );
}

$visibility = "Private";
export function telemetrySpanRecordExceptionImpl(span: any, exception: any, time?: unknown) {
  const state = $getInternalField(span, Field.State) as number;
  if (!(state & State.Recording) || exception == null) return span;
  const flat: unknown[] = [];
  const type = $telemetryErrorType(exception);
  if (type === undefined) {
    // string / number / boolean / bigint: the value is the message (sdk-trace-base does the same for strings)
    if (typeof exception === "symbol") return span;
    $arrayPush(flat, "exception.message");
    $arrayPush(flat, typeof exception === "string" ? exception : exception + "");
  } else {
    $arrayPush(flat, "exception.type");
    $arrayPush(flat, type);
    const message = exception.message;
    if (message != null && message !== "") {
      $arrayPush(flat, "exception.message");
      $arrayPush(flat, typeof message === "string" ? message : message + "");
    }
    const stack = exception.stack;
    if (stack) {
      $arrayPush(flat, "exception.stacktrace");
      $arrayPush(flat, stack + "");
    }
  }
  // flat is never empty here: OTel requires exception.type or exception.message on the event.
  $telemetryAddEvent(span, "exception", flat, time);
  return span;
}

// { k: v, … } → [k, v, …] without null/undefined values (null when not an object).
$visibility = "Private";
export function telemetryFlattenAttributes(attributes: unknown): unknown[] | null {
  if (attributes == null || typeof attributes !== "object") return null;
  const flat: unknown[] = [];
  const keys = Object.keys(attributes as object);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const v = attributes[key];
    if (v != null) {
      $arrayPush(flat, key);
      $arrayPush(flat, v);
    }
  }
  return flat;
}

// One link onto `span` (shared by addLink/addLinks; not user-visible).
$visibility = "Private";
export function telemetryAddOneLink(span: unknown, state: number, link: any) {
  if (link == null || typeof link !== "object") return;
  const ctx = link.context;
  if (ctx == null || typeof ctx.traceId !== "string" || typeof ctx.spanId !== "string") return;
  const traceId = ctx.traceId + "";
  const spanId = ctx.spanId + "";
  // low nibble: W3C flags; 0x10: the linked context is remote (Flags::REMOTE natively)
  const traceFlags = (ctx.traceFlags & 0x0f) | (ctx.isRemote === true ? 0x10 : 0);
  // api TraceState (has serialize()) or a raw header string
  const ts = ctx.traceState;
  const traceState =
    ts == null ? "" : typeof ts === "string" ? ts : typeof ts.serialize === "function" ? ts.serialize() + "" : "";
  const attributes = link.attributes;
  const flat = $telemetryFlattenAttributes(attributes);
  if (state & State.Native) {
    $telemetryAddLink(span, traceId, spanId, traceFlags, flat, traceState);
    return;
  }
  let links = $getInternalField(span, Field.Links) as unknown[] | null;
  if (links === null) {
    links = [];
    $putInternalField(span, Field.Links, links);
  } else if (links.length >= MaxBuffered.LinkValues) {
    return;
  }
  $arrayPush(links, traceId);
  $arrayPush(links, spanId);
  $arrayPush(links, traceFlags);
  $arrayPush(links, flat);
  $arrayPush(links, traceState);
  return;
}

export function addLink(this: unknown, link: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, Field.State) as number;
  if (state & State.Recording) $telemetryAddOneLink(this, state, link);
  return this;
}

export function addLinks(this: unknown, links: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, Field.State) as number;
  if (state & State.Recording && $isJSArray(links)) {
    for (let i = 0; i < links.length; i++) $telemetryAddOneLink(this, state, links[i]);
  }
  return this;
}
