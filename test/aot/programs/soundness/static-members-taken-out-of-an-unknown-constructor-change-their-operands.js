function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const C = structuredClone({}).constructor;

// assign ints apply
{
  const t = [1, 2, 3];
  const F = ((...a) => C.assign.apply(C, a));
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-apply", s);
}

// assign ints bound null
{
  const t = [1, 2, 3];
  const F = C.assign.bind(null);
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-bound-null", s);
}

// assign ints bound
{
  const t = [1, 2, 3];
  const F = C.assign.bind(C);
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-bound", s);
}

// assign ints bracket
{
  const t = [1, 2, 3];
  const F = C["assign"];
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-bracket", s);
}

// assign ints call
{
  const t = [1, 2, 3];
  const F = ((...a) => C.assign.call(C, ...a));
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-call", s);
}

// assign ints closure
{
  const t = [1, 2, 3];
  const F = ((...a) => C.assign(...a));
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-closure", s);
}

// assign ints comma
{
  const t = [1, 2, 3];
  const F = (0, C.assign);
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-comma", s);
}

// assign ints computed
{
  const t = [1, 2, 3];
  const F = C[key("assign")];
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-computed", s);
}

// assign ints conditional
{
  const t = [1, 2, 3];
  const F = (key("y") === "y" ? C.assign : () => 0);
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-conditional", s);
}

// assign ints created computed
{
  const t = [1, 2, 3];
  const F = Object.create(C)[key("assign")];
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-created-computed", s);
}

// assign ints created
{
  const t = [1, 2, 3];
  const F = Object.create(C).assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-created", s);
}

// assign ints descriptor computed
{
  const t = [1, 2, 3];
  const F = Object.getOwnPropertyDescriptor(C, key("assign")).value;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-descriptor-computed", s);
}

// assign ints descriptor
{
  const t = [1, 2, 3];
  const F = Object.getOwnPropertyDescriptor(C, "assign").value;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-descriptor", s);
}

// assign ints descriptors
{
  const t = [1, 2, 3];
  const F = Object.getOwnPropertyDescriptors(C).assign.value;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-descriptors", s);
}

// assign ints destructured
{
  const t = [1, 2, 3];
  const F = (({ assign: f }) => f)(C);
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-destructured", s);
}

// assign ints get prototype of instance
{
  const t = [1, 2, 3];
  const F = C.getPrototypeOf({}).constructor.assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-get-prototype-of-instance", s);
}

// assign ints identity of global computed
{
  const t = [1, 2, 3];
  const F = C(globalThis)[key("Object")][key("assign")];
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-identity-of-global-computed", s);
}

// assign ints identity of global
{
  const t = [1, 2, 3];
  const F = C(globalThis).Object.assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-identity-of-global", s);
}

// assign ints identity of object computed
{
  const t = [1, 2, 3];
  const F = C(Object)[key("assign")];
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-identity-of-object-computed", s);
}

// assign ints identity of object
{
  const t = [1, 2, 3];
  const F = C(Object).assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-identity-of-object", s);
}

// assign ints in array
{
  const t = [1, 2, 3];
  const F = [C.assign][0];
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-in-array", s);
}

// assign ints in map
{
  const t = [1, 2, 3];
  const F = new Map([["f", C.assign]]).get("f");
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-in-map", s);
}

// assign ints in object
{
  const t = [1, 2, 3];
  const F = ({ f: C.assign }).f;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-in-object", s);
}

// assign ints known names loop
{
  const t = [1, 2, 3];
  const F = (() => { let f; for (const n of Object.getOwnPropertyNames(C)) if (n === "assign") f = C[n]; return f; })();
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-known-names-loop", s);
}

// assign ints literal proto
{
  const t = [1, 2, 3];
  const F = ({ __proto__: C }).assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-literal-proto", s);
}

// assign ints logical
{
  const t = [1, 2, 3];
  const F = (C.nothing || C.assign);
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-logical", s);
}

// assign ints name
{
  const t = [1, 2, 3];
  const F = C.assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-name", s);
}

// assign ints names loop
{
  const t = [1, 2, 3];
  const F = (() => { let f; for (const n of C.getOwnPropertyNames(C)) if (n === "assign") f = C[n]; return f; })();
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-names-loop", s);
}

// assign ints optional
{
  const t = [1, 2, 3];
  const F = C?.assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-optional", s);
}

// assign ints own descriptor
{
  const t = [1, 2, 3];
  const F = C.getOwnPropertyDescriptor(C, "assign").value;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-own-descriptor", s);
}

// assign ints own descriptors computed
{
  const t = [1, 2, 3];
  const F = C.getOwnPropertyDescriptors(C)[key("assign")].value;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-own-descriptors-computed", s);
}

// assign ints prototype constructor
{
  const t = [1, 2, 3];
  const F = C.prototype.constructor.assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-prototype-constructor", s);
}

// assign ints proxy
{
  const t = [1, 2, 3];
  const F = new Proxy(C, {}).assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-proxy", s);
}

// assign ints reflect apply
{
  const t = [1, 2, 3];
  const F = ((...a) => Reflect.apply(C.assign, C, a));
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-reflect-apply", s);
}

// assign ints reflect get computed
{
  const t = [1, 2, 3];
  const F = Reflect.get(C, key("assign"));
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-reflect-get-computed", s);
}

// assign ints reflect get
{
  const t = [1, 2, 3];
  const F = Reflect.get(C, "assign");
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-reflect-get", s);
}

// assign ints set prototype
{
  const t = [1, 2, 3];
  const F = Object.setPrototypeOf({}, C).assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-set-prototype", s);
}

// assign ints subclass super
{
  const t = [1, 2, 3];
  const F = (class X extends C { static get() { return super.assign; } }).get();
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-subclass-super", s);
}

// assign ints subclass
{
  const t = [1, 2, 3];
  const F = (class X extends C {}).assign;
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-subclass", s);
}

// assign ints through identity
{
  const t = [1, 2, 3];
  const F = C(C.assign);
  F(t, ["s"]);
  let s = 0; for (let i = 0; i < t.length; i++) s = s + t[i]; console.log("assign-ints-through-identity", s);
}

// define plain apply
{
  const t = { a: 1, b: 2 };
  const F = ((...a) => C.defineProperty.apply(C, a));
  F(t, "a", { value: "s" });
  console.log("define-plain-apply", t.a + t.b, typeof t.a);
}

// define plain bound null
{
  const t = { a: 1, b: 2 };
  const F = C.defineProperty.bind(null);
  F(t, "a", { value: "s" });
  console.log("define-plain-bound-null", t.a + t.b, typeof t.a);
}

// define plain bound
{
  const t = { a: 1, b: 2 };
  const F = C.defineProperty.bind(C);
  F(t, "a", { value: "s" });
  console.log("define-plain-bound", t.a + t.b, typeof t.a);
}

// define plain bracket
{
  const t = { a: 1, b: 2 };
  const F = C["defineProperty"];
  F(t, "a", { value: "s" });
  console.log("define-plain-bracket", t.a + t.b, typeof t.a);
}

// define plain call
{
  const t = { a: 1, b: 2 };
  const F = ((...a) => C.defineProperty.call(C, ...a));
  F(t, "a", { value: "s" });
  console.log("define-plain-call", t.a + t.b, typeof t.a);
}

// define plain closure
{
  const t = { a: 1, b: 2 };
  const F = ((...a) => C.defineProperty(...a));
  F(t, "a", { value: "s" });
  console.log("define-plain-closure", t.a + t.b, typeof t.a);
}

// define plain comma
{
  const t = { a: 1, b: 2 };
  const F = (0, C.defineProperty);
  F(t, "a", { value: "s" });
  console.log("define-plain-comma", t.a + t.b, typeof t.a);
}

// define plain computed
{
  const t = { a: 1, b: 2 };
  const F = C[key("defineProperty")];
  F(t, "a", { value: "s" });
  console.log("define-plain-computed", t.a + t.b, typeof t.a);
}

// define plain conditional
{
  const t = { a: 1, b: 2 };
  const F = (key("y") === "y" ? C.defineProperty : () => 0);
  F(t, "a", { value: "s" });
  console.log("define-plain-conditional", t.a + t.b, typeof t.a);
}

// define plain created computed
{
  const t = { a: 1, b: 2 };
  const F = Object.create(C)[key("defineProperty")];
  F(t, "a", { value: "s" });
  console.log("define-plain-created-computed", t.a + t.b, typeof t.a);
}

// define plain created
{
  const t = { a: 1, b: 2 };
  const F = Object.create(C).defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-created", t.a + t.b, typeof t.a);
}

// define plain descriptor computed
{
  const t = { a: 1, b: 2 };
  const F = Object.getOwnPropertyDescriptor(C, key("defineProperty")).value;
  F(t, "a", { value: "s" });
  console.log("define-plain-descriptor-computed", t.a + t.b, typeof t.a);
}

// define plain descriptor
{
  const t = { a: 1, b: 2 };
  const F = Object.getOwnPropertyDescriptor(C, "defineProperty").value;
  F(t, "a", { value: "s" });
  console.log("define-plain-descriptor", t.a + t.b, typeof t.a);
}

// define plain descriptors
{
  const t = { a: 1, b: 2 };
  const F = Object.getOwnPropertyDescriptors(C).defineProperty.value;
  F(t, "a", { value: "s" });
  console.log("define-plain-descriptors", t.a + t.b, typeof t.a);
}

// define plain destructured
{
  const t = { a: 1, b: 2 };
  const F = (({ defineProperty: f }) => f)(C);
  F(t, "a", { value: "s" });
  console.log("define-plain-destructured", t.a + t.b, typeof t.a);
}

// define plain get prototype of instance
{
  const t = { a: 1, b: 2 };
  const F = C.getPrototypeOf({}).constructor.defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-get-prototype-of-instance", t.a + t.b, typeof t.a);
}

// define plain identity of global computed
{
  const t = { a: 1, b: 2 };
  const F = C(globalThis)[key("Object")][key("defineProperty")];
  F(t, "a", { value: "s" });
  console.log("define-plain-identity-of-global-computed", t.a + t.b, typeof t.a);
}

// define plain identity of global
{
  const t = { a: 1, b: 2 };
  const F = C(globalThis).Object.defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-identity-of-global", t.a + t.b, typeof t.a);
}

// define plain identity of object computed
{
  const t = { a: 1, b: 2 };
  const F = C(Object)[key("defineProperty")];
  F(t, "a", { value: "s" });
  console.log("define-plain-identity-of-object-computed", t.a + t.b, typeof t.a);
}

// define plain identity of object
{
  const t = { a: 1, b: 2 };
  const F = C(Object).defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-identity-of-object", t.a + t.b, typeof t.a);
}

// define plain in array
{
  const t = { a: 1, b: 2 };
  const F = [C.defineProperty][0];
  F(t, "a", { value: "s" });
  console.log("define-plain-in-array", t.a + t.b, typeof t.a);
}

// define plain in map
{
  const t = { a: 1, b: 2 };
  const F = new Map([["f", C.defineProperty]]).get("f");
  F(t, "a", { value: "s" });
  console.log("define-plain-in-map", t.a + t.b, typeof t.a);
}

// define plain in object
{
  const t = { a: 1, b: 2 };
  const F = ({ f: C.defineProperty }).f;
  F(t, "a", { value: "s" });
  console.log("define-plain-in-object", t.a + t.b, typeof t.a);
}

// define plain known names loop
{
  const t = { a: 1, b: 2 };
  const F = (() => { let f; for (const n of Object.getOwnPropertyNames(C)) if (n === "defineProperty") f = C[n]; return f; })();
  F(t, "a", { value: "s" });
  console.log("define-plain-known-names-loop", t.a + t.b, typeof t.a);
}

// define plain literal proto
{
  const t = { a: 1, b: 2 };
  const F = ({ __proto__: C }).defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-literal-proto", t.a + t.b, typeof t.a);
}

// define plain logical
{
  const t = { a: 1, b: 2 };
  const F = (C.nothing || C.defineProperty);
  F(t, "a", { value: "s" });
  console.log("define-plain-logical", t.a + t.b, typeof t.a);
}

// define plain name
{
  const t = { a: 1, b: 2 };
  const F = C.defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-name", t.a + t.b, typeof t.a);
}

// define plain names loop
{
  const t = { a: 1, b: 2 };
  const F = (() => { let f; for (const n of C.getOwnPropertyNames(C)) if (n === "defineProperty") f = C[n]; return f; })();
  F(t, "a", { value: "s" });
  console.log("define-plain-names-loop", t.a + t.b, typeof t.a);
}

// define plain optional
{
  const t = { a: 1, b: 2 };
  const F = C?.defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-optional", t.a + t.b, typeof t.a);
}

// define plain own descriptor
{
  const t = { a: 1, b: 2 };
  const F = C.getOwnPropertyDescriptor(C, "defineProperty").value;
  F(t, "a", { value: "s" });
  console.log("define-plain-own-descriptor", t.a + t.b, typeof t.a);
}

// define plain own descriptors computed
{
  const t = { a: 1, b: 2 };
  const F = C.getOwnPropertyDescriptors(C)[key("defineProperty")].value;
  F(t, "a", { value: "s" });
  console.log("define-plain-own-descriptors-computed", t.a + t.b, typeof t.a);
}

// define plain prototype constructor
{
  const t = { a: 1, b: 2 };
  const F = C.prototype.constructor.defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-prototype-constructor", t.a + t.b, typeof t.a);
}

// define plain proxy
{
  const t = { a: 1, b: 2 };
  const F = new Proxy(C, {}).defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-proxy", t.a + t.b, typeof t.a);
}

// define plain reflect apply
{
  const t = { a: 1, b: 2 };
  const F = ((...a) => Reflect.apply(C.defineProperty, C, a));
  F(t, "a", { value: "s" });
  console.log("define-plain-reflect-apply", t.a + t.b, typeof t.a);
}

// define plain reflect get computed
{
  const t = { a: 1, b: 2 };
  const F = Reflect.get(C, key("defineProperty"));
  F(t, "a", { value: "s" });
  console.log("define-plain-reflect-get-computed", t.a + t.b, typeof t.a);
}

// define plain reflect get
{
  const t = { a: 1, b: 2 };
  const F = Reflect.get(C, "defineProperty");
  F(t, "a", { value: "s" });
  console.log("define-plain-reflect-get", t.a + t.b, typeof t.a);
}

// define plain set prototype
{
  const t = { a: 1, b: 2 };
  const F = Object.setPrototypeOf({}, C).defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-set-prototype", t.a + t.b, typeof t.a);
}

// define plain subclass super
{
  const t = { a: 1, b: 2 };
  const F = (class X extends C { static get() { return super.defineProperty; } }).get();
  F(t, "a", { value: "s" });
  console.log("define-plain-subclass-super", t.a + t.b, typeof t.a);
}

// define plain subclass
{
  const t = { a: 1, b: 2 };
  const F = (class X extends C {}).defineProperty;
  F(t, "a", { value: "s" });
  console.log("define-plain-subclass", t.a + t.b, typeof t.a);
}

// define plain through identity
{
  const t = { a: 1, b: 2 };
  const F = C(C.defineProperty);
  F(t, "a", { value: "s" });
  console.log("define-plain-through-identity", t.a + t.b, typeof t.a);
}

// freeze plain apply
{
  const t = { a: 1 };
  const F = ((...a) => C.freeze.apply(C, a));
  F(t);
  console.log("freeze-plain-apply", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain bound null
{
  const t = { a: 1 };
  const F = C.freeze.bind(null);
  F(t);
  console.log("freeze-plain-bound-null", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain bound
{
  const t = { a: 1 };
  const F = C.freeze.bind(C);
  F(t);
  console.log("freeze-plain-bound", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain bracket
{
  const t = { a: 1 };
  const F = C["freeze"];
  F(t);
  console.log("freeze-plain-bracket", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain call
{
  const t = { a: 1 };
  const F = ((...a) => C.freeze.call(C, ...a));
  F(t);
  console.log("freeze-plain-call", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain closure
{
  const t = { a: 1 };
  const F = ((...a) => C.freeze(...a));
  F(t);
  console.log("freeze-plain-closure", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain comma
{
  const t = { a: 1 };
  const F = (0, C.freeze);
  F(t);
  console.log("freeze-plain-comma", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain computed
{
  const t = { a: 1 };
  const F = C[key("freeze")];
  F(t);
  console.log("freeze-plain-computed", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain conditional
{
  const t = { a: 1 };
  const F = (key("y") === "y" ? C.freeze : () => 0);
  F(t);
  console.log("freeze-plain-conditional", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain created computed
{
  const t = { a: 1 };
  const F = Object.create(C)[key("freeze")];
  F(t);
  console.log("freeze-plain-created-computed", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain created
{
  const t = { a: 1 };
  const F = Object.create(C).freeze;
  F(t);
  console.log("freeze-plain-created", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain descriptor computed
{
  const t = { a: 1 };
  const F = Object.getOwnPropertyDescriptor(C, key("freeze")).value;
  F(t);
  console.log("freeze-plain-descriptor-computed", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain descriptor
{
  const t = { a: 1 };
  const F = Object.getOwnPropertyDescriptor(C, "freeze").value;
  F(t);
  console.log("freeze-plain-descriptor", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain descriptors
{
  const t = { a: 1 };
  const F = Object.getOwnPropertyDescriptors(C).freeze.value;
  F(t);
  console.log("freeze-plain-descriptors", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain destructured
{
  const t = { a: 1 };
  const F = (({ freeze: f }) => f)(C);
  F(t);
  console.log("freeze-plain-destructured", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain get prototype of instance
{
  const t = { a: 1 };
  const F = C.getPrototypeOf({}).constructor.freeze;
  F(t);
  console.log("freeze-plain-get-prototype-of-instance", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain identity of global computed
{
  const t = { a: 1 };
  const F = C(globalThis)[key("Object")][key("freeze")];
  F(t);
  console.log("freeze-plain-identity-of-global-computed", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain identity of global
{
  const t = { a: 1 };
  const F = C(globalThis).Object.freeze;
  F(t);
  console.log("freeze-plain-identity-of-global", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain identity of object computed
{
  const t = { a: 1 };
  const F = C(Object)[key("freeze")];
  F(t);
  console.log("freeze-plain-identity-of-object-computed", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain identity of object
{
  const t = { a: 1 };
  const F = C(Object).freeze;
  F(t);
  console.log("freeze-plain-identity-of-object", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain in array
{
  const t = { a: 1 };
  const F = [C.freeze][0];
  F(t);
  console.log("freeze-plain-in-array", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain in map
{
  const t = { a: 1 };
  const F = new Map([["f", C.freeze]]).get("f");
  F(t);
  console.log("freeze-plain-in-map", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain in object
{
  const t = { a: 1 };
  const F = ({ f: C.freeze }).f;
  F(t);
  console.log("freeze-plain-in-object", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain known names loop
{
  const t = { a: 1 };
  const F = (() => { let f; for (const n of Object.getOwnPropertyNames(C)) if (n === "freeze") f = C[n]; return f; })();
  F(t);
  console.log("freeze-plain-known-names-loop", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain literal proto
{
  const t = { a: 1 };
  const F = ({ __proto__: C }).freeze;
  F(t);
  console.log("freeze-plain-literal-proto", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain logical
{
  const t = { a: 1 };
  const F = (C.nothing || C.freeze);
  F(t);
  console.log("freeze-plain-logical", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain name
{
  const t = { a: 1 };
  const F = C.freeze;
  F(t);
  console.log("freeze-plain-name", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain names loop
{
  const t = { a: 1 };
  const F = (() => { let f; for (const n of C.getOwnPropertyNames(C)) if (n === "freeze") f = C[n]; return f; })();
  F(t);
  console.log("freeze-plain-names-loop", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain optional
{
  const t = { a: 1 };
  const F = C?.freeze;
  F(t);
  console.log("freeze-plain-optional", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain own descriptor
{
  const t = { a: 1 };
  const F = C.getOwnPropertyDescriptor(C, "freeze").value;
  F(t);
  console.log("freeze-plain-own-descriptor", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain own descriptors computed
{
  const t = { a: 1 };
  const F = C.getOwnPropertyDescriptors(C)[key("freeze")].value;
  F(t);
  console.log("freeze-plain-own-descriptors-computed", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain prototype constructor
{
  const t = { a: 1 };
  const F = C.prototype.constructor.freeze;
  F(t);
  console.log("freeze-plain-prototype-constructor", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain proxy
{
  const t = { a: 1 };
  const F = new Proxy(C, {}).freeze;
  F(t);
  console.log("freeze-plain-proxy", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain reflect apply
{
  const t = { a: 1 };
  const F = ((...a) => Reflect.apply(C.freeze, C, a));
  F(t);
  console.log("freeze-plain-reflect-apply", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain reflect get computed
{
  const t = { a: 1 };
  const F = Reflect.get(C, key("freeze"));
  F(t);
  console.log("freeze-plain-reflect-get-computed", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain reflect get
{
  const t = { a: 1 };
  const F = Reflect.get(C, "freeze");
  F(t);
  console.log("freeze-plain-reflect-get", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain set prototype
{
  const t = { a: 1 };
  const F = Object.setPrototypeOf({}, C).freeze;
  F(t);
  console.log("freeze-plain-set-prototype", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain subclass super
{
  const t = { a: 1 };
  const F = (class X extends C { static get() { return super.freeze; } }).get();
  F(t);
  console.log("freeze-plain-subclass-super", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain subclass
{
  const t = { a: 1 };
  const F = (class X extends C {}).freeze;
  F(t);
  console.log("freeze-plain-subclass", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// freeze plain through identity
{
  const t = { a: 1 };
  const F = C(C.freeze);
  F(t);
  console.log("freeze-plain-through-identity", attempt(() => { t.a = 7; return t.a; }), attempt(() => { t.z = 1; return t.z; }));
}

// setproto inst apply
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = ((...a) => C.setPrototypeOf.apply(C, a));
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-apply", t.m(), t instanceof Q);
}

// setproto inst bound null
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C.setPrototypeOf.bind(null);
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-bound-null", t.m(), t instanceof Q);
}

// setproto inst bound
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C.setPrototypeOf.bind(C);
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-bound", t.m(), t instanceof Q);
}

// setproto inst bracket
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C["setPrototypeOf"];
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-bracket", t.m(), t instanceof Q);
}

// setproto inst call
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = ((...a) => C.setPrototypeOf.call(C, ...a));
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-call", t.m(), t instanceof Q);
}

// setproto inst closure
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = ((...a) => C.setPrototypeOf(...a));
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-closure", t.m(), t instanceof Q);
}

// setproto inst comma
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = (0, C.setPrototypeOf);
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-comma", t.m(), t instanceof Q);
}

// setproto inst computed
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C[key("setPrototypeOf")];
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-computed", t.m(), t instanceof Q);
}

// setproto inst conditional
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = (key("y") === "y" ? C.setPrototypeOf : () => 0);
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-conditional", t.m(), t instanceof Q);
}

// setproto inst created computed
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = Object.create(C)[key("setPrototypeOf")];
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-created-computed", t.m(), t instanceof Q);
}

// setproto inst created
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = Object.create(C).setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-created", t.m(), t instanceof Q);
}

// setproto inst descriptor computed
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = Object.getOwnPropertyDescriptor(C, key("setPrototypeOf")).value;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-descriptor-computed", t.m(), t instanceof Q);
}

// setproto inst descriptor
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = Object.getOwnPropertyDescriptor(C, "setPrototypeOf").value;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-descriptor", t.m(), t instanceof Q);
}

// setproto inst descriptors
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = Object.getOwnPropertyDescriptors(C).setPrototypeOf.value;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-descriptors", t.m(), t instanceof Q);
}

// setproto inst destructured
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = (({ setPrototypeOf: f }) => f)(C);
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-destructured", t.m(), t instanceof Q);
}

// setproto inst get prototype of instance
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C.getPrototypeOf({}).constructor.setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-get-prototype-of-instance", t.m(), t instanceof Q);
}

// setproto inst identity of global computed
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C(globalThis)[key("Object")][key("setPrototypeOf")];
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-identity-of-global-computed", t.m(), t instanceof Q);
}

// setproto inst identity of global
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C(globalThis).Object.setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-identity-of-global", t.m(), t instanceof Q);
}

// setproto inst identity of object computed
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C(Object)[key("setPrototypeOf")];
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-identity-of-object-computed", t.m(), t instanceof Q);
}

// setproto inst identity of object
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C(Object).setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-identity-of-object", t.m(), t instanceof Q);
}

// setproto inst in array
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = [C.setPrototypeOf][0];
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-in-array", t.m(), t instanceof Q);
}

// setproto inst in map
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = new Map([["f", C.setPrototypeOf]]).get("f");
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-in-map", t.m(), t instanceof Q);
}

// setproto inst in object
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = ({ f: C.setPrototypeOf }).f;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-in-object", t.m(), t instanceof Q);
}

// setproto inst known names loop
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = (() => { let f; for (const n of Object.getOwnPropertyNames(C)) if (n === "setPrototypeOf") f = C[n]; return f; })();
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-known-names-loop", t.m(), t instanceof Q);
}

// setproto inst literal proto
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = ({ __proto__: C }).setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-literal-proto", t.m(), t instanceof Q);
}

// setproto inst logical
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = (C.nothing || C.setPrototypeOf);
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-logical", t.m(), t instanceof Q);
}

// setproto inst name
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C.setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-name", t.m(), t instanceof Q);
}

// setproto inst names loop
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = (() => { let f; for (const n of C.getOwnPropertyNames(C)) if (n === "setPrototypeOf") f = C[n]; return f; })();
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-names-loop", t.m(), t instanceof Q);
}

// setproto inst optional
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C?.setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-optional", t.m(), t instanceof Q);
}

// setproto inst own descriptor
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C.getOwnPropertyDescriptor(C, "setPrototypeOf").value;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-own-descriptor", t.m(), t instanceof Q);
}

// setproto inst own descriptors computed
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C.getOwnPropertyDescriptors(C)[key("setPrototypeOf")].value;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-own-descriptors-computed", t.m(), t instanceof Q);
}

// setproto inst prototype constructor
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C.prototype.constructor.setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-prototype-constructor", t.m(), t instanceof Q);
}

// setproto inst proxy
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = new Proxy(C, {}).setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-proxy", t.m(), t instanceof Q);
}

// setproto inst reflect apply
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = ((...a) => Reflect.apply(C.setPrototypeOf, C, a));
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-reflect-apply", t.m(), t instanceof Q);
}

// setproto inst reflect get computed
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = Reflect.get(C, key("setPrototypeOf"));
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-reflect-get-computed", t.m(), t instanceof Q);
}

// setproto inst reflect get
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = Reflect.get(C, "setPrototypeOf");
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-reflect-get", t.m(), t instanceof Q);
}

// setproto inst set prototype
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = Object.setPrototypeOf({}, C).setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-set-prototype", t.m(), t instanceof Q);
}

// setproto inst subclass super
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = (class X extends C { static get() { return super.setPrototypeOf; } }).get();
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-subclass-super", t.m(), t instanceof Q);
}

// setproto inst subclass
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = (class X extends C {}).setPrototypeOf;
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-subclass", t.m(), t instanceof Q);
}

// setproto inst through identity
{
  class Q { constructor() { this.a = 1; } m() { return "Q.m"; } }
  const t = new Q();
  const F = C(C.setPrototypeOf);
  F(t, { m() { return "other.m"; } });
  console.log("setproto-inst-through-identity", t.m(), t instanceof Q);
}
