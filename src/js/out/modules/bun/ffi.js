var h = function (J) {
    return new __GlobalBunCString(J);
  },
  T = function (J, j, q, z) {
    const E = typeof FFIType[j] === "number" && FFIType[j] !== FFIType.void;
    var G = new Array(J.length),
      H = new Array(J.length);
    for (let Q = 0; Q < J.length; Q++) {
      G[Q] = `p${Q}`;
      const U = A[FFIType[J[Q]]];
      if (U) H[Q] = `(${U.toString()})(p${Q})`;
      else throw new TypeError(`Unsupported type ${J[Q]}. Must be one of: ${Object.keys(FFIType).sort().join(", ")}`);
    }
    var K = `functionToCall(${H.join(", ")})`;
    if (E)
      if (FFIType[j] === FFIType.cstring) K = `return (${h.toString()})(${K})`;
      else K = `return ${K}`;
    var M = new Function("functionToCall", ...G, K);
    Object.defineProperty(M, "name", { value: z });
    var P;
    switch (G.length) {
      case 0:
        P = () => M(q);
        break;
      case 1:
        P = Q => M(q, Q);
        break;
      case 2:
        P = (Q, U) => M(q, Q, U);
        break;
      case 3:
        P = (Q, U, V) => M(q, Q, U, V);
        break;
      case 4:
        P = (Q, U, V, X) => M(q, Q, U, V, X);
        break;
      case 5:
        P = (Q, U, V, X, Y) => M(q, Q, U, V, X, Y);
        break;
      case 6:
        P = (Q, U, V, X, Y, Z) => M(q, Q, U, V, X, Y, Z);
        break;
      case 7:
        P = (Q, U, V, X, Y, Z, $) => M(q, Q, U, V, X, Y, Z, $);
        break;
      case 8:
        P = (Q, U, V, X, Y, Z, $, D) => M(q, Q, U, V, X, Y, Z, $, D);
        break;
      case 9:
        P = (Q, U, V, X, Y, Z, $, D, I) => M(q, Q, U, V, X, Y, Z, $, D, I);
        break;
      default: {
        P = (...Q) => M(q, ...Q);
        break;
      }
    }
    return (P.native = q), (P.ptr = q.ptr), P;
  };
function y(J, j) {
  const q = w(J, j);
  for (let E in q.symbols) {
    var z = q.symbols[E];
    if (j[E]?.args?.length || FFIType[j[E]?.returns] === FFIType.cstring)
      q.symbols[E] = T(
        j[E].args ?? [],
        j[E].returns ?? FFIType.void,
        z,
        J.includes("/") ? `${E} (${J.split("/").pop()})` : `${E} (${J})`,
      );
    else q.symbols[E].native = q.symbols[E];
  }
  return q;
}
function u(J) {
  const j = L(J);
  for (let z in j.symbols) {
    var q = j.symbols[z];
    if (J[z]?.args?.length || FFIType[J[z]?.returns] === FFIType.cstring)
      j.symbols[z] = T(J[z].args ?? [], J[z].returns ?? FFIType.void, q, z);
    else j.symbols[z].native = j.symbols[z];
  }
  return j;
}
var s = function (J) {
  J();
};
function g(J) {
  const j = `CFunction${c++}`;
  var q = u({ [j]: J }),
    z = !1,
    E = q.close;
  return (
    (q.symbols[j].close = () => {
      if (z || !E) return;
      (z = !0), E(), (E = void 0);
    }),
    (S ||= new FinalizationRegistry(s)),
    S.register(q.symbols[j], q.symbols[j].close),
    q.symbols[j]
  );
}
var F = "dylib",
  N = globalThis.Bun.FFI,
  R = (J, j) => (typeof j === "undefined" ? N.ptr(J) : N.ptr(J, j)),
  x = N.toBuffer,
  O = N.toArrayBuffer,
  B = N.viewSource,
  _ = N.CString,
  L = N.linkSymbols,
  w = N.dlopen,
  d = N.callback,
  k = N.closeCallback;
delete N.callback;
delete N.closeCallback;
class W {
  constructor(J, j) {
    const { ctx: q, ptr: z } = d(j, J);
    (this.#J = q), (this.ptr = z), (this.#j = !!j?.threadsafe);
  }
  ptr;
  #J;
  #j;
  get threadsafe() {
    return this.#j;
  }
  [Symbol.toPrimitive]() {
    const { ptr: J } = this;
    return typeof J === "number" ? J : 0;
  }
  close() {
    const J = this.#J;
    if (((this.ptr = null), (this.#J = null), J)) k(J);
  }
}
class b extends String {
  constructor(J, j, q) {
    super(J ? (typeof q === "number" && Number.isSafeInteger(q) ? new _(J, j || 0, q) : new _(J)) : "");
    if (((this.ptr = typeof J === "number" ? J : 0), typeof j !== "undefined")) this.byteOffset = j;
    if (typeof q !== "undefined") this.byteLength = q;
  }
  ptr;
  byteOffset;
  byteLength;
  #J;
  get arrayBuffer() {
    if (this.#J) return this.#J;
    if (!this.ptr) return (this.#J = new ArrayBuffer(0));
    return (this.#J = O(this.ptr, this.byteOffset, this.byteLength));
  }
}
Object.defineProperty(globalThis, "__GlobalBunCString", { value: b, enumerable: !1, configurable: !1 });
var A = new Array(18),
  m = J => J | 0;
A.fill(m);
A[FFIType.uint8_t] = function J(j) {
  return j < 0 ? 0 : j >= 255 ? 255 : j | 0;
};
A[FFIType.int16_t] = function J(j) {
  return j <= -32768 ? -32768 : j >= 32768 ? 32768 : j | 0;
};
A[FFIType.uint16_t] = function J(j) {
  return j <= 0 ? 0 : j >= 65536 ? 65536 : j | 0;
};
A[FFIType.int32_t] = function J(j) {
  return j | 0;
};
A[FFIType.uint32_t] = function J(j) {
  return j <= 0 ? 0 : j >= 4294967295 ? 4294967295 : +j || 0;
};
A[FFIType.i64_fast] = function J(j) {
  if (typeof j === "bigint") {
    if (j <= BigInt(Number.MAX_SAFE_INTEGER) && j >= BigInt(-Number.MAX_SAFE_INTEGER)) return Number(j).valueOf() || 0;
    return j;
  }
  return !j ? 0 : +j || 0;
};
A[FFIType.u64_fast] = function J(j) {
  if (typeof j === "bigint") {
    if (j <= BigInt(Number.MAX_SAFE_INTEGER) && j >= 0) return Number(j).valueOf() || 0;
    return j;
  }
  return !j ? 0 : +j || 0;
};
A[FFIType.int64_t] = function J(j) {
  if (typeof j === "bigint") return j;
  if (typeof j === "number") return BigInt(j || 0);
  return BigInt(+j || 0);
};
A[FFIType.uint64_t] = function J(j) {
  if (typeof j === "bigint") return j;
  if (typeof j === "number") return j <= 0 ? BigInt(0) : BigInt(j || 0);
  return BigInt(+j || 0);
};
A[FFIType.u64_fast] = function J(j) {
  if (typeof j === "bigint") {
    if (j <= BigInt(Number.MAX_SAFE_INTEGER) && j >= BigInt(0)) return Number(j);
    return j;
  }
  return typeof j === "number" ? (j <= 0 ? 0 : +j || 0) : +j || 0;
};
A[FFIType.uint16_t] = function J(j) {
  const q = (typeof j === "bigint" ? Number(j) : j) | 0;
  return q <= 0 ? 0 : q > 65535 ? 65535 : q;
};
A[FFIType.double] = function J(j) {
  if (typeof j === "bigint") {
    if (j.valueOf() < BigInt(Number.MAX_VALUE))
      return Math.abs(Number(j).valueOf()) + 0.00000000000001 - 0.00000000000001;
  }
  if (!j) return 0;
  return j + 0.00000000000001 - 0.00000000000001;
};
A[FFIType.float] = A[10] = function J(j) {
  return Math.fround(j);
};
A[FFIType.bool] = function J(j) {
  return !!j;
};
Object.defineProperty(globalThis, "__GlobalBunFFIPtrFunctionForWrapper", {
  value: R,
  enumerable: !1,
  configurable: !0,
});
A[FFIType.cstring] = A[FFIType.pointer] = function J(j) {
  if (typeof j === "number") return j;
  if (!j) return null;
  if (ArrayBuffer.isView(j) || j instanceof ArrayBuffer) return __GlobalBunFFIPtrFunctionForWrapper(j);
  if (typeof j === "string") throw new TypeError("To convert a string to a pointer, encode it as a buffer");
  throw new TypeError(`Unable to convert ${j} to a pointer`);
};
A[FFIType.function] = function J(j) {
  if (typeof j === "number") return j;
  if (typeof j === "bigint") return Number(j);
  var q = j && j.ptr;
  if (!q) throw new TypeError("Expected function to be a JSCallback or a number");
  return q;
};
var C = {
    dlopen: w,
    callback: () => {
      throw new Error("Deprecated. Use new JSCallback(options, fn) instead");
    },
  },
  c = 0,
  S,
  i = N.read;
export {
  B as viewSource,
  x as toBuffer,
  O as toArrayBuffer,
  F as suffix,
  i as read,
  R as ptr,
  C as native,
  u as linkSymbols,
  y as dlopen,
  W as JSCallback,
  b as CString,
  g as CFunction,
};
