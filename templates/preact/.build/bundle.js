// node_modules/preact/dist/preact.module.js
var h = function(n, l) {
  for (var u in l)
    n[u] = l[u];
  return n;
};
var v = function(n) {
  var l = n.parentNode;
  l && l.removeChild(n);
};
var y = function(l, u, i) {
  var t, r, o, f = {};
  for (o in u)
    o == "key" ? t = u[o] : o == "ref" ? r = u[o] : f[o] = u[o];
  if (arguments.length > 2 && (f.children = arguments.length > 3 ? n.call(arguments, 2) : i), typeof l == "function" && l.defaultProps != null)
    for (o in l.defaultProps)
      f[o] === undefined && (f[o] = l.defaultProps[o]);
  return p(l, f, t, r, null);
};
var p = function(n, i, t, r, o) {
  var f = { type: n, props: i, key: t, ref: r, __k: null, __: null, __b: 0, __e: null, __d: undefined, __c: null, __h: null, constructor: undefined, __v: o == null ? ++u : o };
  return o == null && l.vnode != null && l.vnode(f), f;
};
var _ = function(n) {
  return n.children;
};
var k = function(n, l) {
  this.props = n , this.context = l;
};
var b = function(n, l) {
  if (l == null)
    return n.__ ? b(n.__, n.__.__k.indexOf(n) + 1) : null;
  for (var u;l < n.__k.length; l++)
    if ((u = n.__k[l]) != null && u.__e != null)
      return u.__e;
  return typeof n.type == "function" ? b(n) : null;
};
var g = function(n) {
  var l, u;
  if ((n = n.__) != null && n.__c != null) {
    for (n.__e = n.__c.base = null , l = 0;l < n.__k.length; l++)
      if ((u = n.__k[l]) != null && u.__e != null) {
        n.__e = n.__c.base = u.__e;
        break;
      }
    return g(n);
  }
};
var m = function(n) {
  (!n.__d && (n.__d = true) && t.push(n) && !w.__r++ || r !== l.debounceRendering) && ((r = l.debounceRendering) || o)(w);
};
var w = function() {
  var n, l, u, i, r, o, e, c;
  for (t.sort(f);n = t.shift(); )
    n.__d && (l = t.length , i = undefined , r = undefined , e = (o = (u = n).__v).__e , (c = u.__P) && (i = [], (r = h({}, o)).__v = o.__v + 1 , L(c, o, r, u.__n, c.ownerSVGElement !== undefined, o.__h != null ? [e] : null, i, e == null ? b(o) : e, o.__h), M(i, o), o.__e != e && g(o)), t.length > l && t.sort(f));
  w.__r = 0;
};
var x = function(n, l, u, i, t, r, o, f, e, a) {
  var h2, v2, y2, d, k2, g2, m2, w2 = i && i.__k || s, x2 = w2.length;
  for (u.__k = [], h2 = 0;h2 < l.length; h2++)
    if ((d = u.__k[h2] = (d = l[h2]) == null || typeof d == "boolean" || typeof d == "function" ? null : typeof d == "string" || typeof d == "number" || typeof d == "bigint" ? p(null, d, null, null, d) : Array.isArray(d) ? p(_, { children: d }, null, null, null) : d.__b > 0 ? p(d.type, d.props, d.key, d.ref ? d.ref : null, d.__v) : d) != null) {
      if (d.__ = u , d.__b = u.__b + 1 , (y2 = w2[h2]) === null || y2 && d.key == y2.key && d.type === y2.type)
        w2[h2] = undefined;
      else
        for (v2 = 0;v2 < x2; v2++) {
          if ((y2 = w2[v2]) && d.key == y2.key && d.type === y2.type) {
            w2[v2] = undefined;
            break;
          }
          y2 = null;
        }
      L(n, d, y2 = y2 || c, t, r, o, f, e, a), k2 = d.__e , (v2 = d.ref) && y2.ref != v2 && (m2 || (m2 = []), y2.ref && m2.push(y2.ref, null, d), m2.push(v2, d.__c || k2, d)), k2 != null ? (g2 == null && (g2 = k2), typeof d.type == "function" && d.__k === y2.__k ? d.__d = e = A(d, e, n) : e = C(n, d, y2, w2, k2, e), typeof u.type == "function" && (u.__d = e)) : e && y2.__e == e && e.parentNode != n && (e = b(y2));
    }
  for (u.__e = g2 , h2 = x2;h2--; )
    w2[h2] != null && (typeof u.type == "function" && w2[h2].__e != null && w2[h2].__e == u.__d && (u.__d = $(i).nextSibling), S(w2[h2], w2[h2]));
  if (m2)
    for (h2 = 0;h2 < m2.length; h2++)
      O(m2[h2], m2[++h2], m2[++h2]);
};
var A = function(n, l, u) {
  for (var i, t = n.__k, r = 0;t && r < t.length; r++)
    (i = t[r]) && (i.__ = n , l = typeof i.type == "function" ? A(i, l, u) : C(u, i, i, t, i.__e, l));
  return l;
};
var C = function(n, l, u, i, t, r) {
  var o, f, e;
  if (l.__d !== undefined)
    o = l.__d , l.__d = undefined;
  else if (u == null || t != r || t.parentNode == null)
    n:
      if (r == null || r.parentNode !== n)
        n.appendChild(t), o = null;
      else {
        for (f = r , e = 0;(f = f.nextSibling) && e < i.length; e += 1)
          if (f == t)
            break n;
        n.insertBefore(t, r), o = r;
      }
  return o !== undefined ? o : t.nextSibling;
};
var $ = function(n) {
  var l, u, i;
  if (n.type == null || typeof n.type == "string")
    return n.__e;
  if (n.__k) {
    for (l = n.__k.length - 1;l >= 0; l--)
      if ((u = n.__k[l]) && (i = $(u)))
        return i;
  }
  return null;
};
var H = function(n, l, u, i, t) {
  var r;
  for (r in u)
    r === "children" || r === "key" || (r in l) || T(n, r, null, u[r], i);
  for (r in l)
    t && typeof l[r] != "function" || r === "children" || r === "key" || r === "value" || r === "checked" || u[r] === l[r] || T(n, r, l[r], u[r], i);
};
var I = function(n, l, u) {
  l[0] === "-" ? n.setProperty(l, u == null ? "" : u) : n[l] = u == null ? "" : typeof u != "number" || a.test(l) ? u : u + "px";
};
var T = function(n, l, u, i, t) {
  var r;
  n:
    if (l === "style")
      if (typeof u == "string")
        n.style.cssText = u;
      else {
        if (typeof i == "string" && (n.style.cssText = i = ""), i)
          for (l in i)
            u && (l in u) || I(n.style, l, "");
        if (u)
          for (l in u)
            i && u[l] === i[l] || I(n.style, l, u[l]);
      }
    else if (l[0] === "o" && l[1] === "n")
      r = l !== (l = l.replace(/Capture$/, "")), l = (l.toLowerCase() in n) ? l.toLowerCase().slice(2) : l.slice(2), n.l || (n.l = {}), n.l[l + r] = u , u ? i || n.addEventListener(l, r ? z : j, r) : n.removeEventListener(l, r ? z : j, r);
    else if (l !== "dangerouslySetInnerHTML") {
      if (t)
        l = l.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if (l !== "width" && l !== "height" && l !== "href" && l !== "list" && l !== "form" && l !== "tabIndex" && l !== "download" && (l in n))
        try {
          n[l] = u == null ? "" : u;
          break n;
        } catch (n2) {
        }
      typeof u == "function" || (u == null || u === false && l[4] !== "-" ? n.removeAttribute(l) : n.setAttribute(l, u));
    }
};
var j = function(n) {
  return this.l[n.type + false](l.event ? l.event(n) : n);
};
var z = function(n) {
  return this.l[n.type + true](l.event ? l.event(n) : n);
};
var L = function(n, u, i, t, r, o, f, e, c) {
  var s, a, v2, y2, p2, d, b2, g2, m2, w2, A2, P, C2, $2, H2, I2 = u.type;
  if (u.constructor !== undefined)
    return null;
  i.__h != null && (c = i.__h , e = u.__e = i.__e , u.__h = null , o = [e]), (s = l.__b) && s(u);
  try {
    n:
      if (typeof I2 == "function") {
        if (g2 = u.props , m2 = (s = I2.contextType) && t[s.__c], w2 = s ? m2 ? m2.props.value : s.__ : t , i.__c ? b2 = (a = u.__c = i.__c).__ = a.__E : (("prototype" in I2) && I2.prototype.render ? u.__c = a = new I2(g2, w2) : (u.__c = a = new k(g2, w2), a.constructor = I2 , a.render = q), m2 && m2.sub(a), a.props = g2 , a.state || (a.state = {}), a.context = w2 , a.__n = t , v2 = a.__d = true , a.__h = [], a._sb = []), a.__s == null && (a.__s = a.state), I2.getDerivedStateFromProps != null && (a.__s == a.state && (a.__s = h({}, a.__s)), h(a.__s, I2.getDerivedStateFromProps(g2, a.__s))), y2 = a.props , p2 = a.state , a.__v = u , v2)
          I2.getDerivedStateFromProps == null && a.componentWillMount != null && a.componentWillMount(), a.componentDidMount != null && a.__h.push(a.componentDidMount);
        else {
          if (I2.getDerivedStateFromProps == null && g2 !== y2 && a.componentWillReceiveProps != null && a.componentWillReceiveProps(g2, w2), !a.__e && a.shouldComponentUpdate != null && a.shouldComponentUpdate(g2, a.__s, w2) === false || u.__v === i.__v) {
            for (u.__v !== i.__v && (a.props = g2 , a.state = a.__s , a.__d = false), a.__e = false , u.__e = i.__e , u.__k = i.__k , u.__k.forEach(function(n2) {
              n2 && (n2.__ = u);
            }), A2 = 0;A2 < a._sb.length; A2++)
              a.__h.push(a._sb[A2]);
            a._sb = [], a.__h.length && f.push(a);
            break n;
          }
          a.componentWillUpdate != null && a.componentWillUpdate(g2, a.__s, w2), a.componentDidUpdate != null && a.__h.push(function() {
            a.componentDidUpdate(y2, p2, d);
          });
        }
        if (a.context = w2 , a.props = g2 , a.__P = n , P = l.__r , C2 = 0 , ("prototype" in I2) && I2.prototype.render) {
          for (a.state = a.__s , a.__d = false , P && P(u), s = a.render(a.props, a.state, a.context), $2 = 0;$2 < a._sb.length; $2++)
            a.__h.push(a._sb[$2]);
          a._sb = [];
        } else
          do
            a.__d = false , P && P(u), s = a.render(a.props, a.state, a.context), a.state = a.__s;
          while (a.__d && ++C2 < 25);
        a.state = a.__s , a.getChildContext != null && (t = h(h({}, t), a.getChildContext())), v2 || a.getSnapshotBeforeUpdate == null || (d = a.getSnapshotBeforeUpdate(y2, p2)), H2 = s != null && s.type === _ && s.key == null ? s.props.children : s , x(n, Array.isArray(H2) ? H2 : [H2], u, i, t, r, o, f, e, c), a.base = u.__e , u.__h = null , a.__h.length && f.push(a), b2 && (a.__E = a.__ = null), a.__e = false;
      } else
        o == null && u.__v === i.__v ? (u.__k = i.__k , u.__e = i.__e) : u.__e = N(i.__e, u, i, t, r, o, f, c);
    (s = l.diffed) && s(u);
  } catch (n2) {
    u.__v = null , (c || o != null) && (u.__e = e , u.__h = !!c , o[o.indexOf(e)] = null), l.__e(n2, u, i);
  }
};
var M = function(n, u) {
  l.__c && l.__c(u, n), n.some(function(u2) {
    try {
      n = u2.__h , u2.__h = [], n.some(function(n2) {
        n2.call(u2);
      });
    } catch (n2) {
      l.__e(n2, u2.__v);
    }
  });
};
var N = function(l, u, i, t, r, o, f, e) {
  var s, a, h2, y2 = i.props, p2 = u.props, d = u.type, _2 = 0;
  if (d === "svg" && (r = true), o != null) {
    for (;_2 < o.length; _2++)
      if ((s = o[_2]) && ("setAttribute" in s) == !!d && (d ? s.localName === d : s.nodeType === 3)) {
        l = s , o[_2] = null;
        break;
      }
  }
  if (l == null) {
    if (d === null)
      return document.createTextNode(p2);
    l = r ? document.createElementNS("http://www.w3.org/2000/svg", d) : document.createElement(d, p2.is && p2), o = null , e = false;
  }
  if (d === null)
    y2 === p2 || e && l.data === p2 || (l.data = p2);
  else {
    if (o = o && n.call(l.childNodes), a = (y2 = i.props || c).dangerouslySetInnerHTML , h2 = p2.dangerouslySetInnerHTML , !e) {
      if (o != null)
        for (y2 = {}, _2 = 0;_2 < l.attributes.length; _2++)
          y2[l.attributes[_2].name] = l.attributes[_2].value;
      (h2 || a) && (h2 && (a && h2.__html == a.__html || h2.__html === l.innerHTML) || (l.innerHTML = h2 && h2.__html || ""));
    }
    if (H(l, p2, y2, r, e), h2)
      u.__k = [];
    else if (_2 = u.props.children , x(l, Array.isArray(_2) ? _2 : [_2], u, i, t, r && d !== "foreignObject", o, f, o ? o[0] : i.__k && b(i, 0), e), o != null)
      for (_2 = o.length;_2--; )
        o[_2] != null && v(o[_2]);
    e || (("value" in p2) && (_2 = p2.value) !== undefined && (_2 !== l.value || d === "progress" && !_2 || d === "option" && _2 !== y2.value) && T(l, "value", _2, y2.value, false), ("checked" in p2) && (_2 = p2.checked) !== undefined && _2 !== l.checked && T(l, "checked", _2, y2.checked, false));
  }
  return l;
};
var O = function(n, u, i) {
  try {
    typeof n == "function" ? n(u) : n.current = u;
  } catch (n2) {
    l.__e(n2, i);
  }
};
var S = function(n, u, i) {
  var t, r;
  if (l.unmount && l.unmount(n), (t = n.ref) && (t.current && t.current !== n.__e || O(t, null, u)), (t = n.__c) != null) {
    if (t.componentWillUnmount)
      try {
        t.componentWillUnmount();
      } catch (n2) {
        l.__e(n2, u);
      }
    t.base = t.__P = null , n.__c = undefined;
  }
  if (t = n.__k)
    for (r = 0;r < t.length; r++)
      t[r] && S(t[r], u, i || typeof n.type != "function");
  i || n.__e == null || v(n.__e), n.__ = n.__e = n.__d = undefined;
};
var q = function(n, l, u) {
  return this.constructor(n, u);
};
var B = function(u, i, t) {
  var r, o, f;
  l.__ && l.__(u, i), o = (r = typeof t == "function") ? null : t && t.__k || i.__k , f = [], L(i, u = (!r && t || i).__k = y(_, null, [u]), o || c, c, i.ownerSVGElement !== undefined, !r && t ? [t] : o ? null : i.firstChild ? n.call(i.childNodes) : null, f, !r && t ? t : o ? o.__e : i.firstChild, r), M(f, u);
};
var n;
var l;
var u;
var i;
var t;
var r;
var o;
var f;
var e;
var c = {};
var s = [];
var a = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
n = s.slice , l = { __e: function(n2, l2, u2, i2) {
  for (var t2, r2, o2;l2 = l2.__; )
    if ((t2 = l2.__c) && !t2.__)
      try {
        if ((r2 = t2.constructor) && r2.getDerivedStateFromError != null && (t2.setState(r2.getDerivedStateFromError(n2)), o2 = t2.__d), t2.componentDidCatch != null && (t2.componentDidCatch(n2, i2 || {}), o2 = t2.__d), o2)
          return t2.__E = t2;
      } catch (l3) {
        n2 = l3;
      }
  throw n2;
} }, u = 0 , i = function(n2) {
  return n2 != null && n2.constructor === undefined;
}, k.prototype.setState = function(n2, l2) {
  var u2;
  u2 = this.__s != null && this.__s !== this.state ? this.__s : this.__s = h({}, this.state), typeof n2 == "function" && (n2 = n2(h({}, u2), this.props)), n2 && h(u2, n2), n2 != null && this.__v && (l2 && this._sb.push(l2), m(this));
}, k.prototype.forceUpdate = function(n2) {
  this.__v && (this.__e = true , n2 && this.__h.push(n2), m(this));
}, k.prototype.render = _ , t = [], o = typeof Promise == "function" ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout , f = function(n2, l2) {
  return n2.__v.__b - l2.__v.__b;
}, w.__r = 0 , e = 0;

// node_modules/preact/hooks/dist/hooks.module.js
var d = function(t2, u2) {
  l.__h && l.__h(r2, t2, o2 || u2), o2 = 0;
  var i2 = r2.__H || (r2.__H = { __: [], __h: [] });
  return t2 >= i2.__.length && i2.__.push({ __V: c2 }), i2.__[t2];
};
var h2 = function(n2) {
  return o2 = 1 , s2(B2, n2);
};
var s2 = function(n2, u2, i2) {
  var o2 = d(t2++, 2);
  if (o2.t = n2 , !o2.__c && (o2.__ = [i2 ? i2(u2) : B2(undefined, u2), function(n3) {
    var t2 = o2.__N ? o2.__N[0] : o2.__[0], r2 = o2.t(t2, n3);
    t2 !== r2 && (o2.__N = [r2, o2.__[1]], o2.__c.setState({}));
  }], o2.__c = r2 , !r2.u)) {
    var f2 = function(n3, t2, r2) {
      if (!o2.__c.__H)
        return true;
      var u3 = o2.__c.__H.__.filter(function(n4) {
        return n4.__c;
      });
      if (u3.every(function(n4) {
        return !n4.__N;
      }))
        return !c2 || c2.call(this, n3, t2, r2);
      var i3 = false;
      return u3.forEach(function(n4) {
        if (n4.__N) {
          var t3 = n4.__[0];
          n4.__ = n4.__N , n4.__N = undefined , t3 !== n4.__[0] && (i3 = true);
        }
      }), !(!i3 && o2.__c.props === n3) && (!c2 || c2.call(this, n3, t2, r2));
    };
    r2.u = true;
    var { shouldComponentUpdate: c2, componentWillUpdate: e2 } = r2;
    r2.componentWillUpdate = function(n3, t2, r2) {
      if (this.__e) {
        var u3 = c2;
        c2 = undefined , f2(n3, t2, r2), c2 = u3;
      }
      e2 && e2.call(this, n3, t2, r2);
    }, r2.shouldComponentUpdate = f2;
  }
  return o2.__N || o2.__;
};
var b2 = function() {
  for (var t2;t2 = f2.shift(); )
    if (t2.__P && t2.__H)
      try {
        t2.__H.__h.forEach(k2), t2.__H.__h.forEach(w2), t2.__H.__h = [];
      } catch (r2) {
        t2.__H.__h = [], l.__e(r2, t2.__v);
      }
};
var j2 = function(n2) {
  var t2, r2 = function() {
    clearTimeout(u2), g2 && cancelAnimationFrame(t2), setTimeout(n2);
  }, u2 = setTimeout(r2, 100);
  g2 && (t2 = requestAnimationFrame(r2));
};
var k2 = function(n2) {
  var t2 = r2, u2 = n2.__c;
  typeof u2 == "function" && (n2.__c = undefined , u2()), r2 = t2;
};
var w2 = function(n2) {
  var t2 = r2;
  n2.__c = n2.__(), r2 = t2;
};
var B2 = function(n2, t2) {
  return typeof t2 == "function" ? t2(n2) : t2;
};
var t2;
var r2;
var u2;
var i2;
var o2 = 0;
var f2 = [];
var c2 = [];
var e2 = l.__b;
var a2 = l.__r;
var v2 = l.diffed;
var l2 = l.__c;
var m2 = l.unmount;
l.__b = function(n2) {
  r2 = null , e2 && e2(n2);
}, l.__r = function(n2) {
  a2 && a2(n2), t2 = 0;
  var i3 = (r2 = n2.__c).__H;
  i3 && (u2 === r2 ? (i3.__h = [], r2.__h = [], i3.__.forEach(function(n3) {
    n3.__N && (n3.__ = n3.__N), n3.__V = c2 , n3.__N = n3.i = undefined;
  })) : (i3.__h.forEach(k2), i3.__h.forEach(w2), i3.__h = [])), u2 = r2;
}, l.diffed = function(t3) {
  v2 && v2(t3);
  var o3 = t3.__c;
  o3 && o3.__H && (o3.__H.__h.length && (f2.push(o3) !== 1 && i2 === l.requestAnimationFrame || ((i2 = l.requestAnimationFrame) || j2)(b2)), o3.__H.__.forEach(function(n2) {
    n2.i && (n2.__H = n2.i), n2.__V !== c2 && (n2.__ = n2.__V), n2.i = undefined , n2.__V = c2;
  })), u2 = r2 = null;
}, l.__c = function(t3, r3) {
  r3.some(function(t4) {
    try {
      t4.__h.forEach(k2), t4.__h = t4.__h.filter(function(n2) {
        return !n2.__ || w2(n2);
      });
    } catch (u3) {
      r3.some(function(n2) {
        n2.__h && (n2.__h = []);
      }), r3 = [], l.__e(u3, t4.__v);
    }
  }), l2 && l2(t3, r3);
}, l.unmount = function(t3) {
  m2 && m2(t3);
  var r3, u3 = t3.__c;
  u3 && u3.__H && (u3.__H.__.forEach(function(n2) {
    try {
      k2(n2);
    } catch (n3) {
      r3 = n3;
    }
  }), u3.__H = undefined , r3 && l.__e(r3, u3.__v));
};
var g2 = typeof requestAnimationFrame == "function";

// src/app.tsx
function App() {
  const [count, setCount] = h2(0);
  return o3("div", {
    class: "h-full column-center",
    children: [
      o3("div", {
        class: "row",
        children: [
          o3("a", {
            href: "https://bun.sh",
            target: "_blank",
            children: o3("img", {
              src: "/logo.svg",
              class: "logo",
              alt: "Bun logo"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          o3("a", {
            href: "https://preactjs.com",
            target: "_blank",
            children: o3("img", {
              src: "/preact.svg",
              class: "logo preact",
              alt: "Preact logo"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      o3("h1", {
        children: "Bun + Preact"
      }, undefined, false, undefined, this),
      o3("button", {
        onClick: () => setCount((count2) => count2 + 1),
        children: [
          "count is ",
          count
        ]
      }, undefined, true, undefined, this),
      o3("p", {
        class: "read-the-docs",
        children: "Click on the Bun and Preact logos to learn more"
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
var o3 = function(o4, e3, n2, t3, f3, l3) {
  var s3, u3, a3 = {};
  for (u3 in e3)
    u3 == "ref" ? s3 = e3[u3] : a3[u3] = e3[u3];
  var i3 = { type: o4, props: a3, key: n2, ref: s3, __k: null, __: null, __b: 0, __e: null, __d: undefined, __c: null, __h: null, constructor: undefined, __v: --_2, __source: f3, __self: l3 };
  if (typeof o4 == "function" && (s3 = o4.defaultProps))
    for (u3 in s3)
      a3[u3] === undefined && (a3[u3] = s3[u3]);
  return l.vnode && l.vnode(i3), i3;
};
var _2 = 0;

// src/index.tsx
B(o3(App, {}, undefined, false, undefined, this), document.getElementById("root"));
