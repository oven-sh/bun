// TODO: bindings generator is missing alot
import { Func, dictionary, oneOf, t, Enum } from '../codegen/bindgen-lib';

export const HeadersInit = oneOf(
  t.sequence(t.sequence(t.ByteString)),
  t.record(t.ByteString),
);

export const BodyInit = oneOf(
  t.Blob,
  t.BufferSource,
  t.FormData,
  t.URLSearchParams,
  t.ReadableStream,
  t.USVString,
);

export const RequestInfo = oneOf(
  t.Request,
  t.USVString,
);

export const RequestMode = Enum(
  'navigate',
  'same-origin',
  'no-cors',
  'cors',
);
export const RequestCredentials = Enum(
  'omit',
  'same-origin',
  'include',
);
export const RequestCache = Enum(
  'default',
  'no-store',
  'reload',
  'no-cache',
  'force-cache',
  'only-if-cached',
);
export const RequestRedirect = Enum(
  'follow',
  'error',
  'manual',
);
export const RequestDuplex = Enum(
  'stream',
);
export const RequestPriority = Enum(
  'low',
  'high',
  'auto',
);

export const RequestInit = dictionary({
  method: t.ByteString.default("GET"),
  headers: HeadersInit,
  body: BodyInit.nullable,
  referrer: t.USVString,
  referrerPolicy: t.USVString,
  mode: RequestMode,
  credientials: RequestCredentials,
  cache: RequestCache,
  redirect: RequestRedirect,
  integrity: t.DOMString,
  keepalive: t.boolean.default(true),
  signal: t.AbortSignal.nullable,
  duplex: RequestDuplex,
  priority: RequestPriority,
  window: t.any, // can only be set to null
});

// https://fetch.spec.whatwg.org/#fetch-method
Func({
  name: 'fetch',
  overloads: [{
    file: 'response.zig',
    impl: 'Fetch.Bun__fetch_1',
    args: {
      input: RequestInfo,
      init: RequestInit.optional,
    },
    ret: t.any,
  }]
});