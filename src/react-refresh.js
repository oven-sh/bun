// This is based on v0.11.0 of react-refresh
// The following changes:
// - Removed __DEV__ checks
// - inlined REACT_MEMO_TYPE & REACT_FORWARD_REF_TYPE
// - minified

const F = "for" in Symbol ? Symbol.for("react.forward_ref") : 60112,
  C = "for" in Symbol ? Symbol.for("react.memo") : 60115,
  O = typeof WeakMap == "function" ? WeakMap : Map,
  T = new Map(),
  k = new O(),
  m = new O(),
  M = new O();
let g = [];
const b = new Map(),
  w = new Map(),
  c = new Set(),
  p = new Set(),
  R = typeof WeakMap == "function" ? new WeakMap() : null;
let S = !1;
function _(e) {
  if (e.fullKey !== null) return e.fullKey;
  let t = e.ownKey,
    n;
  try {
    n = e.getCustomHooks();
  } catch {
    return (e.forceReset = !0), (e.fullKey = t), t;
  }
  for (let o = 0; o < n.length; o++) {
    const l = n[o];
    if (typeof l != "function") return (e.forceReset = !0), (e.fullKey = t), t;
    const s = m.get(l);
    if (s === void 0) continue;
    const r = _(s);
    s.forceReset && (e.forceReset = !0),
      (t +=
        `
---
` + r);
  }
  return (e.fullKey = t), t;
}
function D(e, t) {
  const n = m.get(e),
    o = m.get(t);
  return n === void 0 && o === void 0
    ? !0
    : !(n === void 0 || o === void 0 || _(n) !== _(o) || o.forceReset);
}
function B(e) {
  return e.prototype && e.prototype.isReactComponent;
}
function v(e, t) {
  return B(e) || B(t) ? !1 : !!D(e, t);
}
function I(e) {
  return M.get(e);
}
function P(e) {
  const t = new Map();
  return (
    e.forEach((n, o) => {
      t.set(o, n);
    }),
    t
  );
}
function L(e) {
  const t = new Set();
  return (
    e.forEach((n) => {
      t.add(n);
    }),
    t
  );
}
function H(e, t) {
  try {
    return e[t];
  } catch {
    return;
  }
}
function j() {
  if (g.length === 0 || S) return null;
  S = !0;
  try {
    const e = new Set(),
      t = new Set(),
      n = g;
    (g = []),
      n.forEach((f) => {
        let [i, u] = f;
        const a = i.current;
        M.set(a, i),
          M.set(u, i),
          (i.current = u),
          v(a, u) ? t.add(i) : e.add(i);
      });
    const o = { updatedFamilies: t, staleFamilies: e };
    b.forEach((f) => {
      f.setRefreshHandler(I);
    });
    let l = !1,
      s = null;
    const r = L(p),
      h = L(c),
      d = P(w);
    if (
      (r.forEach((f) => {
        const i = d.get(f);
        if (i === void 0)
          throw new Error(
            "Could not find helpers for a root. This is a bug in React Refresh.",
          );
        if ((!p.has(f), R === null || !R.has(f))) return;
        const u = R.get(f);
        try {
          i.scheduleRoot(f, u);
        } catch (a) {
          l || ((l = !0), (s = a));
        }
      }),
      h.forEach((f) => {
        const i = d.get(f);
        if (i === void 0)
          throw new Error(
            "Could not find helpers for a root. This is a bug in React Refresh.",
          );
        !c.has(f);
        try {
          i.scheduleRefresh(f, o);
        } catch (u) {
          l || ((l = !0), (s = u));
        }
      }),
      l)
    )
      throw s;
    return o;
  } finally {
    S = !1;
  }
}
function K(e, t) {
  if (
    e === null ||
    (typeof e != "function" && typeof e != "object") ||
    k.has(e)
  )
    return;
  let n = T.get(t);
  if (
    (n === void 0 ? ((n = { current: e }), T.set(t, n)) : g.push([n, e]),
    k.set(e, n),
    typeof e == "object" && e !== null)
  )
    switch (H(e, "$$typeof")) {
      case F:
        K(e.render, t + "$render");
        break;
      case C:
        K(e.type, t + "$type");
        break;
    }
}
function E(e, t) {
  let n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1,
    o = arguments.length > 3 ? arguments[3] : void 0;
  if (
    (m.has(e) ||
      m.set(e, {
        forceReset: n,
        ownKey: t,
        fullKey: null,
        getCustomHooks: o || (() => []),
      }),
    typeof e == "object" && e !== null)
  )
    switch (H(e, "$$typeof")) {
      case F:
        E(e.render, t, n, o);
        break;
      case C:
        E(e.type, t, n, o);
        break;
    }
}
function A(e) {
  const t = m.get(e);
  t !== void 0 && _(t);
}
function $(e) {
  return T.get(e);
}
function W(e) {
  return k.get(e);
}
function x(e) {
  const t = new Set();
  return (
    c.forEach((n) => {
      const o = w.get(n);
      if (o === void 0)
        throw new Error(
          "Could not find helpers for a root. This is a bug in React Refresh.",
        );
      o.findHostInstancesForRefresh(n, e).forEach((s) => {
        t.add(s);
      });
    }),
    t
  );
}
function z(e) {
  let t = e.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (t === void 0) {
    let s = 0;
    e.__REACT_DEVTOOLS_GLOBAL_HOOK__ = t = {
      renderers: new Map(),
      supportsFiber: !0,
      inject(r) {
        return s++;
      },
      onScheduleFiberRoot(r, h, d) {},
      onCommitFiberRoot(r, h, d, f) {},
      onCommitFiberUnmount() {},
    };
  }
  if (t.isDisabled) {
    console.warn(
      "Something has shimmed the React DevTools global hook (__REACT_DEVTOOLS_GLOBAL_HOOK__). Fast Refresh is not compatible with this shim and will be disabled.",
    );
    return;
  }
  const n = t.inject;
  (t.inject = function (s) {
    const r = n.apply(this, arguments);
    return (
      typeof s.scheduleRefresh == "function" &&
        typeof s.setRefreshHandler == "function" &&
        b.set(r, s),
      r
    );
  }),
    t.renderers.forEach((s, r) => {
      typeof s.scheduleRefresh == "function" &&
        typeof s.setRefreshHandler == "function" &&
        b.set(r, s);
    });
  const o = t.onCommitFiberRoot,
    l = t.onScheduleFiberRoot || (() => {});
  (t.onScheduleFiberRoot = function (s, r, h) {
    return (
      S || (p.delete(r), R !== null && R.set(r, h)), l.apply(this, arguments)
    );
  }),
    (t.onCommitFiberRoot = function (s, r, h, d) {
      const f = b.get(s);
      if (f !== void 0) {
        w.set(r, f);
        const i = r.current,
          u = i.alternate;
        if (u !== null) {
          const a =
              u.memoizedState != null &&
              u.memoizedState.element != null &&
              c.has(r),
            y = i.memoizedState != null && i.memoizedState.element != null;
          !a && y
            ? (c.add(r), p.delete(r))
            : (a && y) ||
              (a && !y
                ? (c.delete(r), d ? p.add(r) : w.delete(r))
                : !a && !y && d && p.add(r));
        } else c.add(r);
      }
      return o.apply(this, arguments);
    });
}
function G() {
  return !1;
}
function N() {
  return c.size;
}
function U() {
  let e,
    t,
    n = !1;
  return function (o, l, s, r) {
    if (typeof l == "string")
      return (
        e || ((e = o), (t = typeof r == "function")),
        o != null &&
          (typeof o == "function" || typeof o == "object") &&
          E(o, l, s, r),
        o
      );
    !n && t && ((n = !0), A(e));
  };
}
function V(e) {
  switch (typeof e) {
    case "function": {
      if (e.prototype != null) {
        if (e.prototype.isReactComponent) return !0;
        const n = Object.getOwnPropertyNames(e.prototype);
        if (
          n.length > 1 ||
          n[0] !== "constructor" ||
          e.prototype.__proto__ !== Object.prototype
        )
          return !1;
      }
      const t = e.name || e.displayName;
      return typeof t == "string" && /^[A-Z]/.test(t);
    }
    case "object": {
      if (e != null)
        switch (H(e, "$$typeof")) {
          case F:
          case C:
            return !0;
          default:
            return !1;
        }
      return !1;
    }
    default:
      return !1;
  }
}
export {
  N as _getMountedRootCount,
  A as collectCustomHooksForSignature,
  U as createSignatureFunctionForTransform,
  x as findAffectedHostInstances,
  $ as getFamilyByID,
  W as getFamilyByType,
  G as hasUnrecoverableErrors,
  z as injectIntoGlobalHook,
  V as isLikelyComponentType,
  j as performReactRefresh,
  K as register,
  E as setSignature,
};
