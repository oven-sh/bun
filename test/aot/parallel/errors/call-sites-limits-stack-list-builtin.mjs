// Stack traces that list a built-in function above its caller: their text, what Error.prepareStackTrace is given, Error.stackTraceLimit, and Error.captureStackTrace with a function to leave out.
const show = (label, f) => {
  try {
    console.log(label, "returned", String(f()));
  } catch (e) {
    console.log(
      label + ":",
      e.stack
        .split("\n")
        .slice(1, 4)
        .map(l => l.trim().replace(/\(?[^\s()]*[\\/]/, "("))
        .join(" | "),
    );
  }
};
let seen;
const text = {
  toString() {
    seen = new Error("x").stack
      .split("\n")
      .slice(1, 4)
      .map(l => l.trim().replace(/\(?[^\s()]*[\\/]/, "("))
      .join(" | ");
    return "a";
  },
};
show("new Uint8Array", function kept() {
  const r = new Uint8Array(-1);
  return r + 1;
});
show("new RegExp", function kept() {
  const r = new RegExp("(");
  return r + 1;
});
show("RegExp", function kept() {
  const r = RegExp("(");
  return r + 1;
});
show("new Array", function kept() {
  const r = new Array(-1);
  return r + 1;
});
show("new Date", function kept() {
  const r = new Date(text);
  return seen;
});
show("new String", function kept() {
  const r = new String(text);
  return seen;
});
show("new Number", function kept() {
  const r = new Number(text);
  return seen;
});
show("Symbol.for", function kept() {
  seen = "nothing";
  const r = Symbol.for(text);
  return seen;
});
show("new Map", function kept() {
  const r = new Map([1]);
  return seen;
});
show("new Error message", function kept() {
  const r = new Error(text);
  return seen;
});
show("Error message", function kept() {
  const r = Error(text);
  return seen;
});
show("new TypeError message", function kept() {
  const r = new TypeError(text);
  return seen;
});
show("new ArrayBuffer", function kept() {
  const r = new ArrayBuffer(-1);
  return seen;
});
show("new DataView", function kept() {
  const r = new DataView(1);
  return seen;
});
show("new Float64Array", function kept() {
  const r = new Float64Array(text);
  return seen;
});
show("new Proxy", function kept() {
  const r = new Proxy(1, 1);
  return seen;
});
show("new WeakRef", function kept() {
  const r = new WeakRef(1);
  return seen;
});
show("new URL", function kept() {
  const r = new URL(text);
  return seen;
});
Error.prepareStackTrace = (e, sites) =>
  sites
    .slice(0, 3)
    .map(s =>
      [
        s.getFunctionName(),
        s.isNative(),
        s.isConstructor(),
        s.isToplevel(),
        typeof s.getFunction(),
        s.getFileName() === null ? null : typeof s.getFileName(),
        s.getLineNumber(),
        s.getTypeName(),
        s.getMethodName(),
        String(s).replace(/\(?[^\s()]*[\\/]/, "("),
      ].join(","),
    )
    .join(" | ");
const sites = (label, f) => {
  try {
    console.log(label, "returned", String(f()));
  } catch (e) {
    console.log(label + ":", e.stack);
  }
};
sites("keys", function kept(o = null) {
  const k = Object.keys(o);
  return k.length;
});
sites("max", function kept() {
  const k = Math.max(Symbol(), 1);
  return k;
});
sites("concat", function kept() {
  const k = "a".concat(Symbol());
  return k;
});
sites("repeat", function kept() {
  const k = "a".repeat(-1);
  return k;
});
Error.stackTraceLimit = 1;
sites("limit 1", function kept(o = null) {
  const k = Object.keys(o);
  return k.length;
});
Error.stackTraceLimit = 2;
sites("limit 2", function kept(o = null) {
  const k = Object.keys(o);
  return k.length;
});
Error.stackTraceLimit = 10;
sites("capture", function kept() {
  const o = {
    toString() {
      const e = {};
      Error.captureStackTrace(e, o.toString);
      throw e;
    },
  };
  return "a".concat(o) + 1;
});
sites("capture concat", function kept() {
  const o = {
    toString() {
      const e = {};
      Error.captureStackTrace(e, String.prototype.concat);
      throw e;
    },
  };
  return "a".concat(o) + 1;
});
sites("capture kept", function kept() {
  const o = {
    toString() {
      const e = {};
      Error.captureStackTrace(e, kept);
      throw e;
    },
  };
  return "a".concat(o) + 1;
});
