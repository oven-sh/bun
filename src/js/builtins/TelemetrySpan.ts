// Prototype methods of Bun.otel / @opentelemetry/api spans (JSTelemetrySpan).
//
// Internal fields (JSTelemetrySpan.h):
//   0 state   int32: bit0 recording, bit1 ended, bit2 native-owned
//   1 attrs   null | [key0, value0, key1, value1, ...]
//   2 name    string | null
//   3 extra   null | { e: events, l: links, s: status, m: message, t: traceState, b: baggage }
//
// Nothing here calls into native unless the span is native-owned (e.g. a
// Bun.serve request span), whose name/attributes live in a native slot.
//
// $telemetryNativeSpanOp(span, op, a, b, c) ops: 0 setAttribute(key, value)
// 1 setName(name) 2 setStatus(code, message) 3 addEvent(name, flatAttrs, time)
// 4 addLink(ctx, flatAttrs)

export function setAttribute(this: unknown, key: unknown, value: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, 0) as number;
  if (!(state & 1) || value == null) return this;
  if (state & 4) {
    $telemetryNativeSpanOp(this, 0, key + "", value);
    return this;
  }
  const attrs = $getInternalField(this, 1) as unknown[] | null;
  key = key + "";
  if (attrs === null) {
    $putInternalField(this, 1, [key, value]);
    return this;
  }
  const n = attrs.length;
  // Overwrite in place if the key is already present (keys are few; the
  // native encoder relies on this to apply the count limit correctly).
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
  const state = $getInternalField(this, 0) as number;
  if (!(state & 1) || attributes == null || typeof attributes !== "object") return this;
  if (state & 4) {
    for (const key in attributes as object) {
      const value = attributes[key];
      if (value != null) $telemetryNativeSpanOp(this, 0, key, value);
    }
    return this;
  }
  let attrs = $getInternalField(this, 1) as unknown[] | null;
  const existing = attrs === null ? 0 : attrs.length;
  for (const key in attributes as object) {
    const value = attributes[key];
    if (value == null) continue;
    if (attrs === null) {
      attrs = [key, value];
      $putInternalField(this, 1, attrs);
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
  const state = $getInternalField(this, 0) as number;
  if (!(state & 1)) return this;
  if (state & 4) {
    $telemetryNativeSpanOp(this, 1, name + "", undefined);
    return this;
  }
  $putInternalField(this, 2, name + "");
  return this;
}

export function isRecording(this: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  return (($getInternalField(this, 0) as number) & 1) !== 0;
}

// setStatus({ code, message }) — or setStatus(code, message?)
export function setStatus(this: unknown, status: any, messageArg?: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, 0) as number;
  if (!(state & 1) || status == null) return this;
  // api SpanStatusCode: UNSET=0 OK=1 ERROR=2
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
  if (state & 4) {
    $telemetryNativeSpanOp(this, 2, code, message);
    return this;
  }
  let x = $getInternalField(this, 3) as any;
  if (x === null) {
    x = { e: null, l: null, s: 0, m: "", t: "", b: "" };
    $putInternalField(this, 3, x);
  } else if (x.s === 1) {
    return this; // Ok is final
  }
  x.s = code;
  x.m = message;
  return this;
}

// addEvent(name, attributesOrStartTime?, startTime?)
export function addEvent(this: unknown, name: unknown, a?: unknown, b?: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, 0) as number;
  if (!(state & 1)) return this;
  let attributes: unknown, time: unknown;
  if (typeof a === "number" || $isJSArray(a) || a instanceof Date) {
    time = a;
  } else {
    attributes = a;
    time = b;
  }
  let flat: unknown[] | null = null;
  if (attributes != null && typeof attributes === "object") {
    flat = [];
    for (const key in attributes as object) {
      const v = attributes[key];
      if (v != null) {
        $arrayPush(flat, key);
        $arrayPush(flat, v);
      }
    }
  }
  if (state & 4) {
    $telemetryNativeSpanOp(this, 3, name + "", flat, time);
    return this;
  }
  let x = $getInternalField(this, 3) as any;
  if (x === null) {
    x = { e: null, l: null, s: 0, m: "", t: "", b: "" };
    $putInternalField(this, 3, x);
  }
  if (x.e === null) x.e = [];
  // Loose cap; the configured event limit is applied natively at end().
  if (x.e.length < 4096 * 3) {
    $arrayPush(x.e, name + "");
    $arrayPush(x.e, time === undefined ? $telemetryNativeSpanOp(undefined, 5, undefined, undefined) : time);
    $arrayPush(x.e, flat);
  }
  return this;
}

export function recordException(this: any, exception: any, time?: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  if (exception == null) return this;
  const attributes: Record<string, string> = {};
  if (typeof exception === "string") {
    attributes["exception.message"] = exception;
  } else {
    const code = exception.code;
    const name = exception.name;
    const message = exception.message;
    const stack = exception.stack;
    if (code != null) attributes["exception.type"] = code + "";
    else if (name) attributes["exception.type"] = name + "";
    if (message) attributes["exception.message"] = message + "";
    if (stack) attributes["exception.stack" + "trace"] = stack + "";
  }
  this.addEvent("exception", attributes, time);
  return this;
}

export function addLink(this: unknown, link: any) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  const state = $getInternalField(this, 0) as number;
  if (!(state & 1) || link == null || typeof link !== "object") return this;
  const ctx = link.context;
  if (ctx == null || typeof ctx.traceId !== "string" || typeof ctx.spanId !== "string") return this;
  let flat: unknown[] | null = null;
  const attributes = link.attributes;
  if (attributes != null && typeof attributes === "object") {
    flat = [];
    for (const key in attributes as object) {
      const v = attributes[key];
      if (v != null) {
        $arrayPush(flat, key);
        $arrayPush(flat, v);
      }
    }
  }
  if (state & 4) {
    $telemetryNativeSpanOp(this, 4, ctx, flat);
    return this;
  }
  let x = $getInternalField(this, 3) as any;
  if (x === null) {
    x = { e: null, l: null, s: 0, m: "", t: "", b: "" };
    $putInternalField(this, 3, x);
  }
  if (x.l === null) x.l = [];
  if (x.l.length < 4096 * 4) {
    $arrayPush(x.l, ctx.traceId + "");
    $arrayPush(x.l, ctx.spanId + "");
    $arrayPush(x.l, ctx.traceFlags | 0);
    $arrayPush(x.l, flat);
  }
  return this;
}

export function addLinks(this: any, links: unknown) {
  if (!$isTelemetrySpan(this)) throw new TypeError("not a Span");
  if ($isJSArray(links)) {
    for (let i = 0; i < links.length; i++) this.addLink(links[i]);
  }
  return this;
}
