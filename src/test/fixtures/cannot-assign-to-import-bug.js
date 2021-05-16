/** @license React v17.0.2
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
"use strict";
var l = require("object-assign"),
  n = 60103,
  p = 60106;
exports.Fragment = 60107;
exports.StrictMode = 60108;
exports.Profiler = 60114;
var q = 60109,
  r = 60110,
  t = 60112;
exports.Suspense = 60113;
var u = 60115,
  v = 60116;
if ("function" === typeof Symbol && Symbol.for) {
  var w = Symbol.for;
  n = w("react.element");
  p = w("react.portal");
  exports.Fragment = w("react.fragment");
  exports.StrictMode = w("react.strict_mode");
  exports.Profiler = w("react.profiler");
  q = w("react.provider");
  r = w("react.context");
  t = w("react.forward_ref");
  exports.Suspense = w("react.suspense");
  u = w("react.memo");
  v = w("react.lazy");
}
var x = "function" === typeof Symbol && Symbol.iterator;
function y(a) {
  if (null === a || "object" !== typeof a) return null;
  a = (x && a[x]) || a["@@iterator"];
  return "function" === typeof a ? a : null;
}
function z(a) {
  for (
    var b = "https://reactjs.org/docs/error-decoder.html?invariant=" + a, c = 1;
    c < arguments.length;
    c++
  )
    b += "&args[]=" + encodeURIComponent(arguments[c]);
  return (
    "Minified React error #" +
    a +
    "; visit " +
    b +
    " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
  );
}
var A = {
    isMounted: function () {
      return !1;
    },
    enqueueForceUpdate: function () {},
    enqueueReplaceState: function () {},
    enqueueSetState: function () {},
  },
  B = {};
function C(a, b, c) {
  this.props = a;
  this.context = b;
  this.refs = B;
  this.updater = c || A;
}
C.prototype.isReactComponent = {};
C.prototype.setState = function (a, b) {
  if ("object" !== typeof a && "function" !== typeof a && null != a)
    throw Error(z(85));
  this.updater.enqueueSetState(this, a, b, "setState");
};
C.prototype.forceUpdate = function (a) {
  this.updater.enqueueForceUpdate(this, a, "forceUpdate");
};
function D() {}
D.prototype = C.prototype;
function E(a, b, c) {
  this.props = a;
  this.context = b;
  this.refs = B;
  this.updater = c || A;
}
var F = (E.prototype = new D());
F.constructor = E;
l(F, C.prototype);
F.isPureReactComponent = !0;
var G = { current: null },
  H = Object.prototype.hasOwnProperty,
  I = { key: !0, ref: !0, __self: !0, __source: !0 };
function J(a, b, c) {
  var e,
    d = {},
    k = null,
    h = null;
  if (null != b)
    for (e in (void 0 !== b.ref && (h = b.ref),
    void 0 !== b.key && (k = "" + b.key),
    b))
      H.call(b, e) && !I.hasOwnProperty(e) && (d[e] = b[e]);
  var g = arguments.length - 2;
  if (1 === g) d.children = c;
  else if (1 < g) {
    for (var f = Array(g), m = 0; m < g; m++) f[m] = arguments[m + 2];
    d.children = f;
  }
  if (a && a.defaultProps)
    for (e in ((g = a.defaultProps), g)) void 0 === d[e] && (d[e] = g[e]);
  return { $$typeof: n, type: a, key: k, ref: h, props: d, _owner: G.current };
}
function K(a, b) {
  return {
    $$typeof: n,
    type: a.type,
    key: b,
    ref: a.ref,
    props: a.props,
    _owner: a._owner,
  };
}
function L(a) {
  return "object" === typeof a && null !== a && a.$$typeof === n;
}
function escape(a) {
  var b = { "=": "=0", ":": "=2" };
  return (
    "$" +
    a.replace(/[=:]/g, function (a) {
      return b[a];
    })
  );
}
var M = /\/+/g;
function N(a, b) {
  return "object" === typeof a && null !== a && null != a.key
    ? escape("" + a.key)
    : b.toString(36);
}
function O(a, b, c, e, d) {
  var k = typeof a;
  if ("undefined" === k || "boolean" === k) a = null;
  var h = !1;
  if (null === a) h = !0;
  else
    switch (k) {
      case "string":
      case "number":
        h = !0;
        break;
      case "object":
        switch (a.$$typeof) {
          case n:
          case p:
            h = !0;
        }
    }
  if (h)
    return (
      (h = a),
      (d = d(h)),
      (a = "" === e ? "." + N(h, 0) : e),
      Array.isArray(d)
        ? ((c = ""),
          null != a && (c = a.replace(M, "$&/") + "/"),
          O(d, b, c, "", function (a) {
            return a;
          }))
        : null != d &&
          (L(d) &&
            (d = K(
              d,
              c +
                (!d.key || (h && h.key === d.key)
                  ? ""
                  : ("" + d.key).replace(M, "$&/") + "/") +
                a
            )),
          b.push(d)),
      1
    );
  h = 0;
  e = "" === e ? "." : e + ":";
  if (Array.isArray(a))
    for (var g = 0; g < a.length; g++) {
      k = a[g];
      var f = e + N(k, g);
      h += O(k, b, c, f, d);
    }
  else if (((f = y(a)), "function" === typeof f))
    for (a = f.call(a), g = 0; !(k = a.next()).done; )
      (k = k.value), (f = e + N(k, g++)), (h += O(k, b, c, f, d));
  else if ("object" === k)
    throw (
      ((b = "" + a),
      Error(
        z(
          31,
          "[object Object]" === b
            ? "object with keys {" + Object.keys(a).join(", ") + "}"
            : b
        )
      ))
    );
  return h;
}
function P(a, b, c) {
  if (null == a) return a;
  var e = [],
    d = 0;
  O(a, e, "", "", function (a) {
    return b.call(c, a, d++);
  });
  return e;
}
function Q(a) {
  if (-1 === a._status) {
    var b = a._result;
    b = b();
    a._status = 0;
    a._result = b;
    b.then(
      function (b) {
        0 === a._status && ((b = b.default), (a._status = 1), (a._result = b));
      },
      function (b) {
        0 === a._status && ((a._status = 2), (a._result = b));
      }
    );
  }
  if (1 === a._status) return a._result;
  throw a._result;
}
var R = { current: null };
function S() {
  var a = R.current;
  if (null === a) throw Error(z(321));
  return a;
}
var T = {
  ReactCurrentDispatcher: R,
  ReactCurrentBatchConfig: { transition: 0 },
  ReactCurrentOwner: G,
  IsSomeRendererActing: { current: !1 },
  assign: l,
};
exports.Children = {
  map: P,
  forEach: function (a, b, c) {
    P(
      a,
      function () {
        b.apply(this, arguments);
      },
      c
    );
  },
  count: function (a) {
    var b = 0;
    P(a, function () {
      b++;
    });
    return b;
  },
  toArray: function (a) {
    return (
      P(a, function (a) {
        return a;
      }) || []
    );
  },
  only: function (a) {
    if (!L(a)) throw Error(z(143));
    return a;
  },
};
exports.Component = C;
exports.PureComponent = E;
exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = T;
exports.cloneElement = function (a, b, c) {
  if (null === a || void 0 === a) throw Error(z(267, a));
  var e = l({}, a.props),
    d = a.key,
    k = a.ref,
    h = a._owner;
  if (null != b) {
    void 0 !== b.ref && ((k = b.ref), (h = G.current));
    void 0 !== b.key && (d = "" + b.key);
    if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
    for (f in b)
      H.call(b, f) &&
        !I.hasOwnProperty(f) &&
        (e[f] = void 0 === b[f] && void 0 !== g ? g[f] : b[f]);
  }
  var f = arguments.length - 2;
  if (1 === f) e.children = c;
  else if (1 < f) {
    g = Array(f);
    for (var m = 0; m < f; m++) g[m] = arguments[m + 2];
    e.children = g;
  }
  return { $$typeof: n, type: a.type, key: d, ref: k, props: e, _owner: h };
};
exports.createContext = function (a, b) {
  void 0 === b && (b = null);
  a = {
    $$typeof: r,
    _calculateChangedBits: b,
    _currentValue: a,
    _currentValue2: a,
    _threadCount: 0,
    Provider: null,
    Consumer: null,
  };
  a.Provider = { $$typeof: q, _context: a };
  return (a.Consumer = a);
};
exports.createElement = J;
exports.createFactory = function (a) {
  var b = J.bind(null, a);
  b.type = a;
  return b;
};
exports.createRef = function () {
  return { current: null };
};
exports.forwardRef = function (a) {
  return { $$typeof: t, render: a };
};
exports.isValidElement = L;
exports.lazy = function (a) {
  return { $$typeof: v, _payload: { _status: -1, _result: a }, _init: Q };
};
exports.memo = function (a, b) {
  return { $$typeof: u, type: a, compare: void 0 === b ? null : b };
};
exports.useCallback = function (a, b) {
  return S().useCallback(a, b);
};
exports.useContext = function (a, b) {
  return S().useContext(a, b);
};
exports.useDebugValue = function () {};
exports.useEffect = function (a, b) {
  return S().useEffect(a, b);
};
exports.useImperativeHandle = function (a, b, c) {
  return S().useImperativeHandle(a, b, c);
};
exports.useLayoutEffect = function (a, b) {
  return S().useLayoutEffect(a, b);
};
exports.useMemo = function (a, b) {
  return S().useMemo(a, b);
};
exports.useReducer = function (a, b, c) {
  return S().useReducer(a, b, c);
};
exports.useRef = function (a) {
  return S().useRef(a);
};
exports.useState = function (a) {
  return S().useState(a);
};
exports.version = "17.0.2";
