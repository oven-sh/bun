// bind of functions of every kind, with a bind of their own, above them or laid later.
let notes = [];
function note(s) {
  notes.push(s);
}
let kept = null;
const N = process.argv.length + 1;
function T(t) {
  return t === void 0 ? "u" : t === null ? "n" : t === globalThis ? "G" : typeof t === "object" ? "o" + Object.keys(t).join() : typeof t + String(t);
}
function show(x) {
  if (x instanceof Promise)
    return "promise";
  if (Array.isArray(x))
    return "[" + x.map(show).join("|") + "]";
  if (x && typeof x === "object")
    return x.next ? "gen" : "{" + Object.keys(x).map((k) => k + ":" + show(x[k])).join() + "}";
  return typeof x === "function" ? "f" : String(x);
}
let total = 0;
function run(name, f) {
  notes = [];
  let a;
  try {
    a = show(f());
  } catch (e) {
    a = "!" + (e && e.constructor && e.constructor.name);
  }
  console.log(name, a, notes.join("|"));
  total++;
}
{
  let F_strict = function(a, b) {
    return [T(this), a, b].join();
  };
  run("strict_7", () => F_strict.bind(null, 1).length);
}
{
  let F_strict = function(a, b) {
    return [T(this), a, b].join();
  };
  run("strict_8", () => new (F_strict.bind(null, 1))(2));
}
{
  let F_strict = function(a, b) {
    return [T(this), a, b].join();
  };
  run("strict_9", () => [1, 2, 3].map(F_strict.bind(null, 7)));
}
{
  let F_strict = function(a, b) {
    return [T(this), a, b].join();
  };
  run("strict_10", () => (() => {
    let s = "";
    for (let k = 0;k < 4; k++) {
      const g = F_strict.bind(null, k);
      s += g(k + 1);
    }
    return s;
  })());
}
{
  let F_strict = function(a, b) {
    return [T(this), a, b].join();
  };
  run("strict_11", () => (() => {
    const g = F_strict.bind("u", 1);
    let s = "";
    for (let k = 0;k < 4; k++)
      s += g(k);
    return s;
  })());
}
{
  let F_strict = function(a, b) {
    return [T(this), a, b].join();
  };
  run("strict_12", () => (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_strict.bind(k, k)(5);
    return s;
  })());
}
{
  const F_arrow = (a, b) => [a, b].join();
  run("arrow_21", () => ("prototype" in F_arrow.bind(null)));
}
{
  const F_arrow = (a, b) => [a, b].join();
  run("arrow_22", () => F_arrow?.bind?.(null, 2)?.(3));
}
{
  const F_named = function inner(a) {
    return T(this) + a;
  };
  run("named_0", () => F_named.bind(null, 1)(2));
}
{
  const F_named = function inner(a) {
    return T(this) + a;
  };
  run("named_1", () => F_named.bind("t", 1, 2)(3));
}
function g_named_16() {
  const F_named = function inner(a) {
    return T(this) + a;
  };
  return F_named.bind(null, 1).apply("x", [2, 3]);
}
run("named_16g", g_named_16);
run("named_16h", g_named_16);
function g_named_20() {
  const F_named = function inner(a) {
    return T(this) + a;
  };
  return (() => {
    const f = F_named;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })();
}
run("named_20g", g_named_20);
run("named_20h", g_named_20);
function g_asyncs_4() {
  async function F_asyncs(a, b) {
    return a + b;
  }
  return F_asyncs.bind(null, 1, 2, 3, 4, 5)(6);
}
run("asyncs_4g", g_asyncs_4);
run("asyncs_4h", g_asyncs_4);
function g_asyncs_8() {
  async function F_asyncs(a, b) {
    return a + b;
  }
  return new (F_asyncs.bind(null, 1))(2);
}
run("asyncs_8g", g_asyncs_8);
run("asyncs_8h", g_asyncs_8);
{
  async function F_asyncs(a, b) {
    return a + b;
  }
  run("asyncs_10", () => (() => {
    let s = "";
    for (let k = 0;k < 4; k++) {
      const g = F_asyncs.bind(null, k);
      s += g(k + 1);
    }
    return s;
  })());
}
{
  async function F_asyncs(a, b) {
    return a + b;
  }
  run("asyncs_11", () => (() => {
    const g = F_asyncs.bind("u", 1);
    let s = "";
    for (let k = 0;k < 4; k++)
      s += g(k);
    return s;
  })());
}
{
  async function F_asyncs(a, b) {
    return a + b;
  }
  run("asyncs_12", () => (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_asyncs.bind(k, k)(5);
    return s;
  })());
}
function g_asyncs_12() {
  async function F_asyncs(a, b) {
    return a + b;
  }
  return (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_asyncs.bind(k, k)(5);
    return s;
  })();
}
run("asyncs_12g", g_asyncs_12);
run("asyncs_12h", g_asyncs_12);
{
  async function F_asyncs(a, b) {
    return a + b;
  }
  run("asyncs_13", () => F_asyncs.bind(null, 1).bind("v", 2)(3));
}
{
  async function F_asyncs(a, b) {
    return a + b;
  }
  run("asyncs_14", () => F_asyncs.bind.call(F_asyncs, "w", 1)(2));
}
{
  async function F_asyncs(a, b) {
    return a + b;
  }
  run("asyncs_15", () => F_asyncs.bind(null, 1).call("x", 2));
}
function g_asyncs_16() {
  async function F_asyncs(a, b) {
    return a + b;
  }
  return F_asyncs.bind(null, 1).apply("x", [2, 3]);
}
run("asyncs_16g", g_asyncs_16);
run("asyncs_16h", g_asyncs_16);
function g_asyncs_20() {
  async function F_asyncs(a, b) {
    return a + b;
  }
  return (() => {
    const f = F_asyncs;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })();
}
run("asyncs_20g", g_asyncs_20);
run("asyncs_20h", g_asyncs_20);
function g_gens_0() {
  function* F_gens(a, b) {
    yield a;
    yield b;
  }
  return F_gens.bind(null, 1)(2);
}
run("gens_0g", g_gens_0);
run("gens_0h", g_gens_0);
function g_gens_4() {
  function* F_gens(a, b) {
    yield a;
    yield b;
  }
  return F_gens.bind(null, 1, 2, 3, 4, 5)(6);
}
run("gens_4g", g_gens_4);
run("gens_4h", g_gens_4);
function g_gens_8() {
  function* F_gens(a, b) {
    yield a;
    yield b;
  }
  return new (F_gens.bind(null, 1))(2);
}
run("gens_8g", g_gens_8);
run("gens_8h", g_gens_8);
{

  class F_klass {
    a;
    constructor(a, b) {
      this.a = [a, b, new.target === F_klass].join();
    }
  }
  run("klass_0", () => F_klass.bind(null, 1)(2));
}
function g_klass_0() {

  class F_klass {
    a;
    constructor(a, b) {
      this.a = [a, b, new.target === F_klass].join();
    }
  }
  return F_klass.bind(null, 1)(2);
}
run("klass_0g", g_klass_0);
run("klass_0h", g_klass_0);
{

  class F_klass {
    a;
    constructor(a, b) {
      this.a = [a, b, new.target === F_klass].join();
    }
  }
  run("klass_1", () => F_klass.bind("t", 1, 2)(3));
}
{

  class F_klass {
    a;
    constructor(a, b) {
      this.a = [a, b, new.target === F_klass].join();
    }
  }
  run("klass_2", () => F_klass.bind({ q: 1 })(1, 2, 3));
}
{

  class F_klass {
    a;
    constructor(a, b) {
      this.a = [a, b, new.target === F_klass].join();
    }
  }
  run("klass_3", () => F_klass.bind()(9));
}
{

  class F_klass {
    a;
    constructor(a, b) {
      this.a = [a, b, new.target === F_klass].join();
    }
  }
  run("klass_4", () => F_klass.bind(null, 1, 2, 3, 4, 5)(6));
}
{

  class F_kstatic {
    static bind(...a) {
      return () => "static " + a.length;
    }
  }
  run("kstatic_13", () => F_kstatic.bind(null, 1).bind("v", 2)(3));
}
{

  class F_kstatic {
    static bind(...a) {
      return () => "static " + a.length;
    }
  }
  run("kstatic_14", () => F_kstatic.bind.call(F_kstatic, "w", 1)(2));
}
{

  class F_kstatic {
    static bind(...a) {
      return () => "static " + a.length;
    }
  }
  run("kstatic_15", () => F_kstatic.bind(null, 1).call("x", 2));
}
{

  class F_kstatic {
    static bind(...a) {
      return () => "static " + a.length;
    }
  }
  run("kstatic_16", () => F_kstatic.bind(null, 1).apply("x", [2, 3]));
}
{

  class F_kstatic {
    static bind(...a) {
      return () => "static " + a.length;
    }
  }
  run("kstatic_17", () => Object.keys(F_kstatic.bind(null, 1)).join());
}
{
  let F_ownlen = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownlen, "length", { get() {
    note("len");
    return 7;
  } });
  run("ownlen_3", () => F_ownlen.bind()(9));
}
{
  let F_ownlen = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownlen, "length", { get() {
    note("len");
    return 7;
  } });
  run("ownlen_4", () => F_ownlen.bind(null, 1, 2, 3, 4, 5)(6));
}
{
  let F_ownlen = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownlen, "length", { get() {
    note("len");
    return 7;
  } });
  run("ownlen_5", () => (() => {
    const g = F_ownlen.bind(null, 1);
    return [g(2), g(3), g === g, typeof g].join(";");
  })());
}
{
  let F_ownlen = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownlen, "length", { get() {
    note("len");
    return 7;
  } });
  run("ownlen_6", () => F_ownlen.bind(null, 1).name);
}
{
  let F_ownlen = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownlen, "length", { get() {
    note("len");
    return 7;
  } });
  run("ownlen_7", () => F_ownlen.bind(null, 1).length);
}
{
  let F_ownlen = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownlen, "length", { get() {
    note("len");
    return 7;
  } });
  run("ownlen_8", () => new (F_ownlen.bind(null, 1))(2));
}
{
  let F_ownname = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownname, "name", { get() {
    note("name");
    return "nn";
  } });
  run("ownname_17", () => Object.keys(F_ownname.bind(null, 1)).join());
}
{
  let F_ownname = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownname, "name", { get() {
    note("name");
    return "nn";
  } });
  run("ownname_18", () => F_ownname.bind(null, 1) instanceof F_ownname);
}
{
  let F_ownname = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownname, "name", { get() {
    note("name");
    return "nn";
  } });
  run("ownname_19", () => String(F_ownname.bind(null, 1)).length > 0);
}
{
  let F_ownname = function(a, b) {
    return [a, b].join();
  };
  Object.defineProperty(F_ownname, "name", { get() {
    note("name");
    return "nn";
  } });
  run("ownname_20", () => (() => {
    const f = F_ownname;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })());
}
function g_ownname_20() {
  function F_ownname(a, b) {
    return [a, b].join();
  }
  Object.defineProperty(F_ownname, "name", { get() {
    note("name");
    return "nn";
  } });
  return (() => {
    const f = F_ownname;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })();
}
run("ownname_20g", g_ownname_20);
run("ownname_20h", g_ownname_20);
function g_extra_12() {
  function F_extra(a, b) {
    return [a, b, F_extra.extra].join();
  }
  F_extra.extra = 5;
  return (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_extra.bind(k, k)(5);
    return s;
  })();
}
run("extra_12g", g_extra_12);
run("extra_12h", g_extra_12);
function g_extra_16() {
  function F_extra(a, b) {
    return [a, b, F_extra.extra].join();
  }
  F_extra.extra = 5;
  return F_extra.bind(null, 1).apply("x", [2, 3]);
}
run("extra_16g", g_extra_16);
run("extra_16h", g_extra_16);
function g_extra_20() {
  function F_extra(a, b) {
    return [a, b, F_extra.extra].join();
  }
  F_extra.extra = 5;
  return (() => {
    const f = F_extra;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })();
}
run("extra_20g", g_extra_20);
run("extra_20h", g_extra_20);
function g_proto_4() {
  function F_proto(a) {
    return a;
  }
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  return F_proto.bind(null, 1, 2, 3, 4, 5)(6);
}
run("proto_4g", g_proto_4);
run("proto_4h", g_proto_4);
{
  let F_proto = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  run("proto_6", () => F_proto.bind(null, 1).name);
}
{
  let F_proto = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  run("proto_7", () => F_proto.bind(null, 1).length);
}
{
  let F_proto = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  run("proto_8", () => new (F_proto.bind(null, 1))(2));
}
function g_proto_8() {
  function F_proto(a) {
    return a;
  }
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  return new (F_proto.bind(null, 1))(2);
}
run("proto_8g", g_proto_8);
run("proto_8h", g_proto_8);
{
  let F_proto = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  run("proto_9", () => [1, 2, 3].map(F_proto.bind(null, 7)));
}
{
  let F_proto = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  run("proto_10", () => (() => {
    let s = "";
    for (let k = 0;k < 4; k++) {
      const g = F_proto.bind(null, k);
      s += g(k + 1);
    }
    return s;
  })());
}
function g_proto_12() {
  function F_proto(a) {
    return a;
  }
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  return (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_proto.bind(k, k)(5);
    return s;
  })();
}
run("proto_12g", g_proto_12);
run("proto_12h", g_proto_12);
function g_proto_16() {
  function F_proto(a) {
    return a;
  }
  Object.setPrototypeOf(F_proto, { bind(...a) {
    return () => "proto " + a.length;
  } });
  return F_proto.bind(null, 1).apply("x", [2, 3]);
}
run("proto_16g", g_proto_16);
run("proto_16h", g_proto_16);
function g_nullp_0() {
  function F_nullp(a) {
    return a;
  }
  Object.setPrototypeOf(F_nullp, null);
  return F_nullp.bind(null, 1)(2);
}
run("nullp_0g", g_nullp_0);
run("nullp_0h", g_nullp_0);
function g_nullp_4() {
  function F_nullp(a) {
    return a;
  }
  Object.setPrototypeOf(F_nullp, null);
  return F_nullp.bind(null, 1, 2, 3, 4, 5)(6);
}
run("nullp_4g", g_nullp_4);
run("nullp_4h", g_nullp_4);
function g_nullp_8() {
  function F_nullp(a) {
    return a;
  }
  Object.setPrototypeOf(F_nullp, null);
  return new (F_nullp.bind(null, 1))(2);
}
run("nullp_8g", g_nullp_8);
run("nullp_8h", g_nullp_8);
{
  let F_nullp = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_nullp, null);
  run("nullp_19", () => String(F_nullp.bind(null, 1)).length > 0);
}
{
  let F_nullp = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_nullp, null);
  run("nullp_20", () => (() => {
    const f = F_nullp;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })());
}
{
  let F_nullp = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_nullp, null);
  run("nullp_21", () => ("prototype" in F_nullp.bind(null)));
}
{
  let F_nullp = function(a) {
    return a;
  };
  Object.setPrototypeOf(F_nullp, null);
  run("nullp_22", () => F_nullp?.bind?.(null, 2)?.(3));
}
{
  const F_bound = function(a, b) {
    return [T(this), a, b].join();
  }.bind("t0", "a0");
  run("bound_0", () => F_bound.bind(null, 1)(2));
}
{
  const F_native = Math.max;
  run("native_9", () => [1, 2, 3].map(F_native.bind(null, 7)));
}
{
  const F_native = Math.max;
  run("native_10", () => (() => {
    let s = "";
    for (let k = 0;k < 4; k++) {
      const g = F_native.bind(null, k);
      s += g(k + 1);
    }
    return s;
  })());
}
{
  const F_native = Math.max;
  run("native_11", () => (() => {
    const g = F_native.bind("u", 1);
    let s = "";
    for (let k = 0;k < 4; k++)
      s += g(k);
    return s;
  })());
}
{
  const F_native = Math.max;
  run("native_12", () => (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_native.bind(k, k)(5);
    return s;
  })());
}
{
  const F_native = Math.max;
  run("native_13", () => F_native.bind(null, 1).bind("v", 2)(3));
}
{
  const F_hostm = [].concat;
  run("hostm_22", () => F_hostm?.bind?.(null, 2)?.(3));
}
{
  const F_proxy = new Proxy(function(a, b) {
    return [T(this), a, b].join();
  }, { get(t, k) {
    note("get " + String(k));
    return Reflect.get(t, k);
  } });
  run("proxy_0", () => F_proxy.bind(null, 1)(2));
}
{
  const F_proxy = new Proxy(function(a, b) {
    return [T(this), a, b].join();
  }, { get(t, k) {
    note("get " + String(k));
    return Reflect.get(t, k);
  } });
  run("proxy_1", () => F_proxy.bind("t", 1, 2)(3));
}
{
  const F_proxy = new Proxy(function(a, b) {
    return [T(this), a, b].join();
  }, { get(t, k) {
    note("get " + String(k));
    return Reflect.get(t, k);
  } });
  run("proxy_2", () => F_proxy.bind({ q: 1 })(1, 2, 3));
}
{
  const F_proxy = new Proxy(function(a, b) {
    return [T(this), a, b].join();
  }, { get(t, k) {
    note("get " + String(k));
    return Reflect.get(t, k);
  } });
  run("proxy_3", () => F_proxy.bind()(9));
}
{
  const F_proxy = new Proxy(function(a, b) {
    return [T(this), a, b].join();
  }, { get(t, k) {
    note("get " + String(k));
    return Reflect.get(t, k);
  } });
  run("proxy_4", () => F_proxy.bind(null, 1, 2, 3, 4, 5)(6));
}
{
  let F_late = function(a, b) {
    return [a, b].join();
  };
  if (N > 2)
    F_late.bind = () => () => "late";
  run("late_12", () => (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_late.bind(k, k)(5);
    return s;
  })());
}
{
  let F_late = function(a, b) {
    return [a, b].join();
  };
  if (N > 2)
    F_late.bind = () => () => "late";
  run("late_13", () => F_late.bind(null, 1).bind("v", 2)(3));
}
{
  let F_late = function(a, b) {
    return [a, b].join();
  };
  if (N > 2)
    F_late.bind = () => () => "late";
  run("late_14", () => F_late.bind.call(F_late, "w", 1)(2));
}
{
  let F_late = function(a, b) {
    return [a, b].join();
  };
  if (N > 2)
    F_late.bind = () => () => "late";
  run("late_15", () => F_late.bind(null, 1).call("x", 2));
}
{
  let F_late = function(a, b) {
    return [a, b].join();
  };
  if (N > 2)
    F_late.bind = () => () => "late";
  run("late_16", () => F_late.bind(null, 1).apply("x", [2, 3]));
}
function g_late_16() {
  function F_late(a, b) {
    return [a, b].join();
  }
  if (N > 2)
    F_late.bind = () => () => "late";
  return F_late.bind(null, 1).apply("x", [2, 3]);
}
run("late_16g", g_late_16);
run("late_16h", g_late_16);
function g_late_20() {
  function F_late(a, b) {
    return [a, b].join();
  }
  if (N > 2)
    F_late.bind = () => () => "late";
  return (() => {
    const f = F_late;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })();
}
run("late_20g", g_late_20);
run("late_20h", g_late_20);
function g_rest_8() {
  function F_rest(...r) {
    return r.join();
  }
  return new (F_rest.bind(null, 1))(2);
}
run("rest_8g", g_rest_8);
run("rest_8h", g_rest_8);
function g_rest_12() {
  function F_rest(...r) {
    return r.join();
  }
  return (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_rest.bind(k, k)(5);
    return s;
  })();
}
run("rest_12g", g_rest_12);
run("rest_12h", g_rest_12);
function g_rest_16() {
  function F_rest(...r) {
    return r.join();
  }
  return F_rest.bind(null, 1).apply("x", [2, 3]);
}
run("rest_16g", g_rest_16);
run("rest_16h", g_rest_16);
function g_rest_20() {
  function F_rest(...r) {
    return r.join();
  }
  return (() => {
    const f = F_rest;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })();
}
run("rest_20g", g_rest_20);
run("rest_20h", g_rest_20);
function g_dflt_0() {
  function F_dflt(a = 4, b = a) {
    return [a, b].join();
  }
  return F_dflt.bind(null, 1)(2);
}
run("dflt_0g", g_dflt_0);
run("dflt_0h", g_dflt_0);
{
  let F_dflt = function(a = 4, b = a) {
    return [a, b].join();
  };
  run("dflt_2", () => F_dflt.bind({ q: 1 })(1, 2, 3));
}
{
  let F_dflt = function(a = 4, b = a) {
    return [a, b].join();
  };
  run("dflt_3", () => F_dflt.bind()(9));
}
{
  let F_dflt = function(a = 4, b = a) {
    return [a, b].join();
  };
  run("dflt_4", () => F_dflt.bind(null, 1, 2, 3, 4, 5)(6));
}
function g_dflt_4() {
  function F_dflt(a = 4, b = a) {
    return [a, b].join();
  }
  return F_dflt.bind(null, 1, 2, 3, 4, 5)(6);
}
run("dflt_4g", g_dflt_4);
run("dflt_4h", g_dflt_4);
{
  let F_dflt = function(a = 4, b = a) {
    return [a, b].join();
  };
  run("dflt_5", () => (() => {
    const g = F_dflt.bind(null, 1);
    return [g(2), g(3), g === g, typeof g].join(";");
  })());
}
{
  let F_dflt = function(a = 4, b = a) {
    return [a, b].join();
  };
  run("dflt_6", () => F_dflt.bind(null, 1).name);
}
function g_dflt_8() {
  function F_dflt(a = 4, b = a) {
    return [a, b].join();
  }
  return new (F_dflt.bind(null, 1))(2);
}
run("dflt_8g", g_dflt_8);
run("dflt_8h", g_dflt_8);
function g_dflt_12() {
  function F_dflt(a = 4, b = a) {
    return [a, b].join();
  }
  return (() => {
    let s = "";
    for (let k = 0;k < 3; k++)
      s += F_dflt.bind(k, k)(5);
    return s;
  })();
}
run("dflt_12g", g_dflt_12);
run("dflt_12h", g_dflt_12);
function g_getter_0() {
  const o = { get m() {
    return (a) => "g" + a;
  } };
  const F_getter = o.m;
  return F_getter.bind(null, 1)(2);
}
run("getter_0g", g_getter_0);
run("getter_0h", g_getter_0);
function g_getter_4() {
  const o = { get m() {
    return (a) => "g" + a;
  } };
  const F_getter = o.m;
  return F_getter.bind(null, 1, 2, 3, 4, 5)(6);
}
run("getter_4g", g_getter_4);
run("getter_4h", g_getter_4);
{
  const o = { get m() {
    return (a) => "g" + a;
  } };
  const F_getter = o.m;
  run("getter_15", () => F_getter.bind(null, 1).call("x", 2));
}
{
  const o = { get m() {
    return (a) => "g" + a;
  } };
  const F_getter = o.m;
  run("getter_16", () => F_getter.bind(null, 1).apply("x", [2, 3]));
}
{
  const o = { get m() {
    return (a) => "g" + a;
  } };
  const F_getter = o.m;
  run("getter_17", () => Object.keys(F_getter.bind(null, 1)).join());
}
{
  const o = { get m() {
    return (a) => "g" + a;
  } };
  const F_getter = o.m;
  run("getter_18", () => F_getter.bind(null, 1) instanceof F_getter);
}
{
  const o = { get m() {
    return (a) => "g" + a;
  } };
  const F_getter = o.m;
  run("getter_19", () => String(F_getter.bind(null, 1)).length > 0);
}
{
  const o = { get m() {
    return (a) => "g" + a;
  } };
  const F_getter = o.m;
  run("getter_20", () => (() => {
    const f = F_getter;
    const g = f.bind(void 0, 8);
    kept = g;
    return kept(1);
  })());
}
function M_plain(a, b, c) {
  return [T(this), a, b, c, arguments.length].join();
}
run("m_plain_3", () => M_plain.bind()(9));
run("m_plain_4", () => M_plain.bind(null, 1, 2, 3, 4, 5)(6));
run("m_plain_5", () => (() => {
  const g = M_plain.bind(null, 1);
  return [g(2), g(3), g === g, typeof g].join(";");
})());
run("m_plain_6", () => M_plain.bind(null, 1).name);
run("m_plain_7", () => M_plain.bind(null, 1).length);
run("m_plain_8", () => new (M_plain.bind(null, 1))(2));
run("m_plain_9", () => [1, 2, 3].map(M_plain.bind(null, 7)));
function M_strict(a, b) {
  return [T(this), a, b].join();
}
run("m_strict_13", () => M_strict.bind(null, 1).bind("v", 2)(3));
run("m_strict_14", () => M_strict.bind.call(M_strict, "w", 1)(2));
run("m_strict_15", () => M_strict.bind(null, 1).call("x", 2));
run("m_strict_16", () => M_strict.bind(null, 1).apply("x", [2, 3]));
run("m_strict_17", () => Object.keys(M_strict.bind(null, 1)).join());
run("m_strict_18", () => M_strict.bind(null, 1) instanceof M_strict);
const M_arrow = (a, b) => [a, b].join();
run("m_arrow_22", () => M_arrow?.bind?.(null, 2)?.(3));
const M_named = function inner(a) {
  return T(this) + a;
};
run("m_named_0", () => M_named.bind(null, 1)(2));
run("m_named_1", () => M_named.bind("t", 1, 2)(3));
run("m_named_2", () => M_named.bind({ q: 1 })(1, 2, 3));
run("m_named_3", () => M_named.bind()(9));
run("m_named_4", () => M_named.bind(null, 1, 2, 3, 4, 5)(6));
async function M_asyncs(a, b) {
  return a + b;
}
run("m_asyncs_8", () => new (M_asyncs.bind(null, 1))(2));
run("m_asyncs_9", () => [1, 2, 3].map(M_asyncs.bind(null, 7)));
run("m_asyncs_10", () => (() => {
  let s = "";
  for (let k = 0;k < 4; k++) {
    const g = M_asyncs.bind(null, k);
    s += g(k + 1);
  }
  return s;
})());
run("m_asyncs_11", () => (() => {
  const g = M_asyncs.bind("u", 1);
  let s = "";
  for (let k = 0;k < 4; k++)
    s += g(k);
  return s;
})());
run("m_asyncs_12", () => (() => {
  let s = "";
  for (let k = 0;k < 3; k++)
    s += M_asyncs.bind(k, k)(5);
  return s;
})());
run("m_asyncs_13", () => M_asyncs.bind(null, 1).bind("v", 2)(3));
run("m_asyncs_14", () => M_asyncs.bind.call(M_asyncs, "w", 1)(2));
function* M_gens(a, b) {
  yield a;
  yield b;
}
run("m_gens_18", () => M_gens.bind(null, 1) instanceof M_gens);
run("m_gens_19", () => String(M_gens.bind(null, 1)).length > 0);
run("m_gens_20", () => (() => {
  const f = M_gens;
  const g = f.bind(void 0, 8);
  kept = g;
  return kept(1);
})());
run("m_gens_21", () => ("prototype" in M_gens.bind(null)));
run("m_gens_22", () => M_gens?.bind?.(null, 2)?.(3));

class M_klass {
  a;
  constructor(a, b) {
    this.a = [a, b, new.target === M_klass].join();
  }
}
run("m_klass_0", () => M_klass.bind(null, 1)(2));

class M_kstatic {
  static bind(...a) {
    return () => "static " + a.length;
  }
}
run("m_kstatic_4", () => M_kstatic.bind(null, 1, 2, 3, 4, 5)(6));
run("m_kstatic_5", () => (() => {
  const g = M_kstatic.bind(null, 1);
  return [g(2), g(3), g === g, typeof g].join(";");
})());
run("m_kstatic_6", () => M_kstatic.bind(null, 1).name);
run("m_kstatic_7", () => M_kstatic.bind(null, 1).length);
run("m_kstatic_8", () => new (M_kstatic.bind(null, 1))(2));
run("m_kstatic_9", () => [1, 2, 3].map(M_kstatic.bind(null, 7)));
run("m_kstatic_10", () => (() => {
  let s = "";
  for (let k = 0;k < 4; k++) {
    const g = M_kstatic.bind(null, k);
    s += g(k + 1);
  }
  return s;
})());
function M_ownbind(a) {
  return a;
}
M_ownbind.bind = function(...a) {
  return (...b) => "own " + a.length + b.length;
};
run("m_ownbind_14", () => M_ownbind.bind.call(M_ownbind, "w", 1)(2));
run("m_ownbind_15", () => M_ownbind.bind(null, 1).call("x", 2));
run("m_ownbind_16", () => M_ownbind.bind(null, 1).apply("x", [2, 3]));
run("m_ownbind_17", () => Object.keys(M_ownbind.bind(null, 1)).join());
run("m_ownbind_18", () => M_ownbind.bind(null, 1) instanceof M_ownbind);
run("m_ownbind_19", () => String(M_ownbind.bind(null, 1)).length > 0);
function M_ownlen(a, b) {
  return [a, b].join();
}
Object.defineProperty(M_ownlen, "length", { get() {
  note("len");
  return 7;
} });
function M_ownname(a, b) {
  return [a, b].join();
}
Object.defineProperty(M_ownname, "name", { get() {
  note("name");
  return "nn";
} });
run("m_ownname_0", () => M_ownname.bind(null, 1)(2));
run("m_ownname_1", () => M_ownname.bind("t", 1, 2)(3));
run("m_ownname_2", () => M_ownname.bind({ q: 1 })(1, 2, 3));
run("m_ownname_3", () => M_ownname.bind()(9));
run("m_ownname_4", () => M_ownname.bind(null, 1, 2, 3, 4, 5)(6));
run("m_ownname_5", () => (() => {
  const g = M_ownname.bind(null, 1);
  return [g(2), g(3), g === g, typeof g].join(";");
})());
function M_extra(a, b) {
  return [a, b, M_extra.extra].join();
}
M_extra.extra = 5;
run("m_extra_9", () => [1, 2, 3].map(M_extra.bind(null, 7)));
run("m_extra_10", () => (() => {
  let s = "";
  for (let k = 0;k < 4; k++) {
    const g = M_extra.bind(null, k);
    s += g(k + 1);
  }
  return s;
})());
run("m_extra_11", () => (() => {
  const g = M_extra.bind("u", 1);
  let s = "";
  for (let k = 0;k < 4; k++)
    s += g(k);
  return s;
})());
run("m_extra_12", () => (() => {
  let s = "";
  for (let k = 0;k < 3; k++)
    s += M_extra.bind(k, k)(5);
  return s;
})());
run("m_extra_13", () => M_extra.bind(null, 1).bind("v", 2)(3));
run("m_extra_14", () => M_extra.bind.call(M_extra, "w", 1)(2));
run("m_extra_15", () => M_extra.bind(null, 1).call("x", 2));
function M_proto(a) {
  return a;
}
Object.setPrototypeOf(M_proto, { bind(...a) {
  return () => "proto " + a.length;
} });
run("m_proto_19", () => String(M_proto.bind(null, 1)).length > 0);
run("m_proto_20", () => (() => {
  const f = M_proto;
  const g = f.bind(void 0, 8);
  kept = g;
  return kept(1);
})());
run("m_proto_21", () => ("prototype" in M_proto.bind(null)));
run("m_proto_22", () => M_proto?.bind?.(null, 2)?.(3));
function M_nullp(a) {
  return a;
}
Object.setPrototypeOf(M_nullp, null);
run("m_nullp_0", () => M_nullp.bind(null, 1)(2));
run("m_nullp_1", () => M_nullp.bind("t", 1, 2)(3));
const M_bound = function(a, b) {
  return [T(this), a, b].join();
}.bind("t0", "a0");
run("m_bound_5", () => (() => {
  const g = M_bound.bind(null, 1);
  return [g(2), g(3), g === g, typeof g].join(";");
})());
run("m_bound_6", () => M_bound.bind(null, 1).name);
run("m_bound_7", () => M_bound.bind(null, 1).length);
run("m_bound_8", () => new (M_bound.bind(null, 1))(2));
run("m_bound_9", () => [1, 2, 3].map(M_bound.bind(null, 7)));
run("m_bound_10", () => (() => {
  let s = "";
  for (let k = 0;k < 4; k++) {
    const g = M_bound.bind(null, k);
    s += g(k + 1);
  }
  return s;
})());
run("m_bound_11", () => (() => {
  const g = M_bound.bind("u", 1);
  let s = "";
  for (let k = 0;k < 4; k++)
    s += g(k);
  return s;
})());
const M_native = Math.max;
run("m_native_15", () => M_native.bind(null, 1).call("x", 2));
run("m_native_16", () => M_native.bind(null, 1).apply("x", [2, 3]));
run("m_native_17", () => Object.keys(M_native.bind(null, 1)).join());
run("m_native_18", () => M_native.bind(null, 1) instanceof M_native);
run("m_native_19", () => String(M_native.bind(null, 1)).length > 0);
run("m_native_20", () => (() => {
  const f = M_native;
  const g = f.bind(void 0, 8);
  kept = g;
  return kept(1);
})());
const M_hostm = [].concat;
const M_proxy = new Proxy(function(a, b) {
  return [T(this), a, b].join();
}, { get(t, k) {
  note("get " + String(k));
  return Reflect.get(t, k);
} });
run("m_proxy_1", () => M_proxy.bind("t", 1, 2)(3));
run("m_proxy_2", () => M_proxy.bind({ q: 1 })(1, 2, 3));
run("m_proxy_3", () => M_proxy.bind()(9));
run("m_proxy_4", () => M_proxy.bind(null, 1, 2, 3, 4, 5)(6));
run("m_proxy_5", () => (() => {
  const g = M_proxy.bind(null, 1);
  return [g(2), g(3), g === g, typeof g].join(";");
})());
run("m_proxy_6", () => M_proxy.bind(null, 1).name);
function M_rest(...r) {
  return r.join();
}
run("m_rest_10", () => (() => {
  let s = "";
  for (let k = 0;k < 4; k++) {
    const g = M_rest.bind(null, k);
    s += g(k + 1);
  }
  return s;
})());
run("m_rest_11", () => (() => {
  const g = M_rest.bind("u", 1);
  let s = "";
  for (let k = 0;k < 4; k++)
    s += g(k);
  return s;
})());
run("m_rest_12", () => (() => {
  let s = "";
  for (let k = 0;k < 3; k++)
    s += M_rest.bind(k, k)(5);
  return s;
})());
run("m_rest_13", () => M_rest.bind(null, 1).bind("v", 2)(3));
run("m_rest_14", () => M_rest.bind.call(M_rest, "w", 1)(2));
run("m_rest_15", () => M_rest.bind(null, 1).call("x", 2));
run("m_rest_16", () => M_rest.bind(null, 1).apply("x", [2, 3]));
function M_dflt(a = 4, b = a) {
  return [a, b].join();
}
run("m_dflt_20", () => (() => {
  const f = M_dflt;
  const g = f.bind(void 0, 8);
  kept = g;
  return kept(1);
})());
run("m_dflt_21", () => ("prototype" in M_dflt.bind(null)));
run("m_dflt_22", () => M_dflt?.bind?.(null, 2)?.(3));
const o_getter = { get m() {
  return (a) => "g" + a;
} };
const M_getter = o_getter.m;
run("m_getter_0", () => M_getter.bind(null, 1)(2));
run("m_getter_1", () => M_getter.bind("t", 1, 2)(3));
run("m_getter_2", () => M_getter.bind({ q: 1 })(1, 2, 3));
console.log(total);

export {};
