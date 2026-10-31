// RUN: lower
// OPTIONS: builtin-modules

// Objects are made late or never while the prototypes of their constructors change.
(function () {
  function V(x) { this.x = x; }
  V.prototype = { constructor: V, get: function () { return this.x + 1; } };
  function W(x) { this.x = x; this.y = 2; }
  W.prototype = { constructor: W, get: function () { return this.x + this.y; } };
  const log = [];
  const kept = [];
  function disturb() { Object.defineProperty(W.prototype, "x", { set(v) { log.push("set x " + v); Object.defineProperty(this, "x", { value: v * 10, writable: true, enumerable: true, configurable: true }); }, get() { return -1; }, configurable: true }); }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { const w = new W(i & 3); sum += new V(i & 7).get() + w.get(); if (i % 97 === 0) kept.push(w); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  function V(x) { this.x = x; }
  V.prototype = { constructor: V, get: function () { return this.x + 1; } };
  function W(x) { this.x = x; this.y = 2; }
  W.prototype = { constructor: W, get: function () { return this.x + this.y; } };
  const log = [];
  const kept = [];
  function disturb() { W.prototype = { constructor: W, get: function () { return 5000 + this.x; }, tag: "second" }; }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { const w = new W(i & 3); sum += w.get() + (w instanceof V ? 1 : 0) + (Object.getPrototypeOf(w) === W.prototype ? 2 : 0) + ("y" in w ? 4 : 0) + (w.hasOwnProperty("y") ? 8 : 0); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  var __extends = (function () {
    var extendStatics = function (d, b) { extendStatics = Object.setPrototypeOf || function (d, b) { d.__proto__ = b; }; return extendStatics(d, b); };
    return function (d, b) { extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __()); };
  })();
  var V = (function () { function V(x) { this.x = x; } V.prototype.get = function () { return this.x + 1; }; return V; })();
  var W = (function (_super) { __extends(W, _super); function W(x) { var _this = _super.call(this, x) || this; _this.y = 2; return _this; } W.prototype.get = function () { return this.x + this.y; }; return W; })(V);
  const log = [];
  const kept = [];
  function disturb() { Object.defineProperty(V.prototype, "y", { set(v) { log.push("set y " + v); }, get() { return 100; }, configurable: true }); }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { const w = new W(i & 3); sum += new V(i & 7).get() + w.get(); if (i % 97 === 0) kept.push(w); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  var __extends = (function () {
    var extendStatics = function (d, b) { extendStatics = Object.setPrototypeOf || function (d, b) { d.__proto__ = b; }; return extendStatics(d, b); };
    return function (d, b) { extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __()); };
  })();
  var V = (function () { function V(x) { this.x = x; } V.prototype.get = function () { return this.x + 1; }; return V; })();
  var W = (function (_super) { __extends(W, _super); function W(x) { var _this = _super.call(this, x) || this; _this.y = 2; return _this; } W.prototype.get = function () { return this.x + this.y; }; return W; })(V);
  const log = [];
  const kept = [];
  function disturb() { Object.setPrototypeOf(W.prototype, { get: function () { return -5; }, extra: 7 }); }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { const w = new W(i & 3); sum += w.get() + (w instanceof V ? 1 : 0) + (Object.getPrototypeOf(w) === W.prototype ? 2 : 0) + ("y" in w ? 4 : 0) + (w.hasOwnProperty("y") ? 8 : 0); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  function V(x) { this.x = x; }
  V.prototype.get = function () { return this.x + 1; };
  function W(x) { V.call(this, x); this.y = 2; }
  W.prototype = Object.create(V.prototype);
  W.prototype.constructor = W;
  W.prototype.get = function () { return this.x + this.y; };
  const log = [];
  const kept = [];
  function disturb() { Object.defineProperty(W.prototype, "y", { value: 9, writable: false, configurable: true }); }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { const w = new W(i & 3); sum += new V(i & 7).get() + w.get(); if (i % 97 === 0) kept.push(w); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  function V(x) { this.x = x; }
  V.prototype.get = function () { return this.x + 1; };
  function W(x) { V.call(this, x); this.y = 2; }
  W.prototype = Object.create(V.prototype);
  W.prototype.constructor = W;
  W.prototype.get = function () { return this.x + this.y; };
  const log = [];
  const kept = [];
  function disturb() { W.prototype.get = function () { return 1000 + this.x; }; }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { sum += new V(i & 7).get() + new W(i & 3).get(); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  function V(x) { this.x = x; }
  V.prototype.get = function () { return this.x + 1; };
  function W(x) { V.call(this, x); this.y = 2; }
  W.prototype = Object.create(V.prototype, { constructor: { value: W, writable: true, configurable: true } });
  W.prototype.get = function () { return this.x + this.y; };
  const log = [];
  const kept = [];
  function disturb() { delete W.prototype.get; }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { const w = new W(i & 3); sum += new V(i & 7).get() + w.get(); if (i % 97 === 0) kept.push(w); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  function V(x) { this.x = x; }
  V.prototype.get = function () { return this.x + 1; };
  function W(x) { V.call(this, x); this.y = 2; }
  W.prototype = Object.create(V.prototype, { constructor: { value: W, writable: true, configurable: true } });
  W.prototype.get = function () { return this.x + this.y; };
  const log = [];
  const kept = [];
  function disturb() { Object.freeze(W.prototype); Object.freeze(V.prototype); }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { const w = new W(i & 3); sum += w.get() + (w instanceof V ? 1 : 0) + (Object.getPrototypeOf(w) === W.prototype ? 2 : 0) + ("y" in w ? 4 : 0) + (w.hasOwnProperty("y") ? 8 : 0); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  function inherits(child, parent) { child.prototype = Object.create(parent.prototype); child.prototype.constructor = child; }
  function V(x) { this.x = x; }
  V.prototype.get = function () { return this.x + 1; };
  function W(x) { V.call(this, x); this.y = 2; }
  inherits(W, V);
  W.prototype.get = function () { return this.x + this.y; };
  const log = [];
  const kept = [];
  function disturb() { W.prototype = { constructor: W, get: function () { return 5000 + this.x; }, tag: "second" }; }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { const w = new W(i & 3); sum += new V(i & 7).get() + w.get(); if (i % 97 === 0) kept.push(w); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();
(function () {
  function inherits(child, parent) { child.prototype = Object.create(parent.prototype); child.prototype.constructor = child; }
  function V(x) { this.x = x; }
  V.prototype.get = function () { return this.x + 1; };
  function W(x) { V.call(this, x); this.y = 2; }
  inherits(W, V);
  W.prototype.get = function () { return this.x + this.y; };
  const log = [];
  const kept = [];
  function disturb() { Object.defineProperty(W.prototype, "x", { set(v) { log.push("set x " + v); Object.defineProperty(this, "x", { value: v * 10, writable: true, enumerable: true, configurable: true }); }, get() { return -1; }, configurable: true }); }
  function run(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) {
      if (i === 700) disturb();
      try { sum += new V(i & 7).get() + new W(i & 3).get(); } catch (error) { sum -= 1; if (log.length < 3) log.push(error.constructor.name); }
    }
    return sum;
  }
  console.log(run(0, 600), run(600, 1300), run(1300, 1400));
  console.log(log.slice(0, 6).join(" | "), log.length, kept.length);
  for (const w of kept.slice(0, 12)) console.log(JSON.stringify(w), Object.keys(w).join(), Object.getPrototypeOf(w) === W.prototype, w.y, typeof w.get === "function" ? w.get() : "none");
})();

// GENERATED: inherits extendStatics __
// CHECK-LABEL: function {{*}}name="inherits"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v4 = PropGet v1 key="prototype"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeName="Object.create"
// CHECK-NEXT: PropSet v0, v6 key="prototype"
// CHECK-NEXT: v8 = PropGet v0 key="prototype"
// CHECK-NEXT: PropSet v8, v0 key="constructor"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inherits"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v4 = PropGet v1 key="prototype"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeName="Object.create"
// CHECK-NEXT: PropSet v0, v6 key="prototype"
// CHECK-NEXT: v8 = PropGet v0 key="prototype"
// CHECK-NEXT: PropSet v8, v0 key="constructor"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="extendStatics"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=2 captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=ObjectSetPrototypeOf
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_2]]
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v7 = Call v6, -, v1, v2 calleeName="extendStatics"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="extendStatics"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=2 captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=ObjectSetPrototypeOf
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_4]]
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v7 = Call v6, -, v1, v2 calleeName="extendStatics"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] captures=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: PropSet v1, v0 key="constructor"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] captures=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: PropSet v1, v0 key="constructor"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
