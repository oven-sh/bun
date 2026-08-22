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
  // Keys stay unique: a repeated key overwrites in place (keys are few).
  const n = attrs.length;
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

export function setAttributes(this: unknown, attributes: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, Field.State) as number;
  if (!(state & State.Recording) || attributes == null || typeof attributes !== "object") return this;
  if (state & State.Native) {
    for (const key in attributes as object) {
      const value = attributes[key];
      if (value != null) $telemetrySetAttribute(this, key, value);
    }
    return this;
  }
  let attrs = $getInternalField(this, Field.Attributes) as unknown[] | null;
  const existing = attrs === null ? 0 : attrs.length;
  for (const key in attributes as object) {
    const value = attributes[key];
    if (value == null) continue;
    if (attrs === null) {
      attrs = [key, value];
      $putInternalField(this, Field.Attributes, attrs);
      continue;
    }
    let i = 0;
    for (; i < existing; i += 2) {
      if (attrs[i] === key) {
        attrs[i + 1] = value;
        break;
      }
    }
    if (i >= existing) {
      $arrayPush(attrs, key);
      $arrayPush(attrs, value);
    }
  }
  return this;
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
  const state = $getInternalField(this, Field.State) as number;
  if (!(state & State.Recording) || status == null) return this;
  // api SpanStatusCode: UNSET 0, OK 1, ERROR 2
  let code: number, msg: unknown;
  if (typeof status === "number") {
    code = status | 0;
    msg = messageArg;
  } else {
    code = status.code | 0;
    msg = status.message;
  }
  if (code !== 1 && code !== 2) return this;
  const message = code === 2 && msg != null ? msg + "" : "";
  if (state & State.Native) {
    $telemetrySetStatus(this, code, message);
    return this;
  }
  // OK is final.
  if (($getInternalField(this, Field.StatusCode) as number) === 1) return this;
  $putInternalField(this, Field.StatusCode, code);
  $putInternalField(this, Field.StatusMessage, message);
  return this;
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

export function recordException(this: any, exception: any, time?: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, Field.State) as number;
  if (!(state & State.Recording) || exception == null) return this;
  const flat: unknown[] = [];
  if (typeof exception === "string") {
    $arrayPush(flat, "exception.message");
    $arrayPush(flat, exception);
  } else {
    const code = exception.code;
    const name = exception.name;
    const message = exception.message;
    const stack = exception.stack;
    const type = code != null ? code + "" : name ? name + "" : undefined;
    if (type !== undefined) {
      $arrayPush(flat, "exception.type");
      $arrayPush(flat, type);
    }
    if (message) {
      $arrayPush(flat, "exception.message");
      $arrayPush(flat, message + "");
    }
    if (stack) {
      $arrayPush(flat, "exception.stacktrace");
      $arrayPush(flat, stack + "");
    }
  }
  $telemetryAddEvent(this, "exception", flat, time);
  return this;
}

// { k: v, … } → [k, v, …] without null/undefined values (null when not an object).
$visibility = "Private";
export function telemetryFlattenAttributes(attributes: unknown): unknown[] | null {
  if (attributes == null || typeof attributes !== "object") return null;
  const flat: unknown[] = [];
  for (const key in attributes as object) {
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
  const traceFlags = ctx.traceFlags | 0;
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
