// A descriptor comes to one of its members by a getter, from an object above, under a computed key, by a copy or through a proxy. What was defined is listed, copied, written as JSON, stored to and deleted.
class Point { constructor(w, x) { this.w = w; this.x = x; } }
function attempt(run) { try { return run(); } catch (e) { return "threw " + e.constructor.name; } }
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, configurable: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, configurable: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, set: function (x) { this.y = x; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, set: function (x) { this.y = x; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, get: () => 7 };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, get: () => 7 };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, configurable: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, configurable: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, writable: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, writable: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, value: "text" };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, value: "text" };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, value: { deep: 1 } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, value: { deep: 1 } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, writable: false };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | own-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, writable: false };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | own-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, get enumerable() { return true; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, get enumerable() { return true; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, get configurable() { return true; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, get configurable() { return true; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, get set() { return function (x) { this.y = x; }; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, get set() { return function (x) { this.y = x; }; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, get get() { return () => 7; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, get get() { return () => 7; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, get enumerable() { return true; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, get enumerable() { return true; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, get configurable() { return true; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, get configurable() { return true; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, get writable() { return true; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, get writable() { return true; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, get value() { return "text"; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, get value() { return "text"; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, get value() { return { deep: 1 }; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, get value() { return { deep: 1 }; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, get writable() { return false; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | own-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, get writable() { return false; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | own-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, __proto__: { enumerable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, __proto__: { enumerable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, __proto__: { configurable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, __proto__: { configurable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, __proto__: { set: function (x) { this.y = x; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, __proto__: { set: function (x) { this.y = x; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, __proto__: { get: () => 7 } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, __proto__: { get: () => 7 } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { enumerable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { enumerable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { configurable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { configurable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { writable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { writable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, __proto__: { value: "text" } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, __proto__: { value: "text" } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, __proto__: { value: { deep: 1 } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, __proto__: { value: { deep: 1 } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, __proto__: { writable: false } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | inherited-value | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, __proto__: { writable: false } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | inherited-value | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, __proto__: { get enumerable() { return true; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, __proto__: { get enumerable() { return true; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, __proto__: { get configurable() { return true; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, __proto__: { get configurable() { return true; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, __proto__: { get set() { return function (x) { this.y = x; }; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, __proto__: { get set() { return function (x) { this.y = x; }; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, __proto__: { get get() { return () => 7; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, __proto__: { get get() { return () => 7; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { get enumerable() { return true; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { get enumerable() { return true; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { get configurable() { return true; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { get configurable() { return true; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { get writable() { return true; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, __proto__: { get writable() { return true; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, __proto__: { get value() { return "text"; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, __proto__: { get value() { return "text"; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, __proto__: { get value() { return { deep: 1 }; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, __proto__: { get value() { return { deep: 1 }; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, __proto__: { get writable() { return false; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | inherited-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, __proto__: { get writable() { return false; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | inherited-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get enumerable() { return true; } })(), { get: () => 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get enumerable() { return true; } })(), { get: () => 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get configurable() { return true; } })(), { get: () => 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get configurable() { return true; } })(), { get: () => 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get set() { return function (x) { this.y = x; }; } })(), { get: () => 7, enumerable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get set() { return function (x) { this.y = x; }; } })(), { get: () => 7, enumerable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get get() { return () => 7; } })(), { enumerable: true, configurable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get get() { return () => 7; } })(), { enumerable: true, configurable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get enumerable() { return true; } })(), { value: 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get enumerable() { return true; } })(), { value: 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get configurable() { return true; } })(), { value: 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get configurable() { return true; } })(), { value: 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get writable() { return true; } })(), { value: 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get writable() { return true; } })(), { value: 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get value() { return "text"; } })(), { enumerable: true, writable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get value() { return "text"; } })(), { enumerable: true, writable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get value() { return { deep: 1 }; } })(), { enumerable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get value() { return { deep: 1 }; } })(), { enumerable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get writable() { return false; } })(), { value: 7, enumerable: true, configurable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | class-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(new (class { get writable() { return false; } })(), { value: 7, enumerable: true, configurable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | class-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ enumerable: true }), { get: () => 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ enumerable: true }), { get: () => 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ configurable: true }), { get: () => 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ configurable: true }), { get: () => 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ set: function (x) { this.y = x; } }), { get: () => 7, enumerable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ set: function (x) { this.y = x; } }), { get: () => 7, enumerable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ get: () => 7 }), { enumerable: true, configurable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ get: () => 7 }), { enumerable: true, configurable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ enumerable: true }), { value: 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ enumerable: true }), { value: 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ configurable: true }), { value: 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ configurable: true }), { value: 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ writable: true }), { value: 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ writable: true }), { value: 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ value: "text" }), { enumerable: true, writable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ value: "text" }), { enumerable: true, writable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ value: { deep: 1 } }), { enumerable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ value: { deep: 1 } }), { enumerable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ writable: false }), { value: 7, enumerable: true, configurable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | created-below | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign(Object.create({ writable: false }), { value: 7, enumerable: true, configurable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | created-below | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ get: () => 7, enumerable: true }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ get: () => 7, enumerable: true }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ get: () => 7, configurable: true }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ get: () => 7, configurable: true }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ get: () => 7, enumerable: true, set: function (x) { this.y = x; } }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ get: () => 7, enumerable: true, set: function (x) { this.y = x; } }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ enumerable: true, configurable: true, get: () => 7 }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ enumerable: true, configurable: true, get: () => 7 }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ value: 7, enumerable: true }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ value: 7, enumerable: true }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ value: 7, configurable: true }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ value: 7, configurable: true }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ value: 7, writable: true }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ value: 7, writable: true }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ enumerable: true, writable: true, value: "text" }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ enumerable: true, writable: true, value: "text" }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ enumerable: true, value: { deep: 1 } }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ enumerable: true, value: { deep: 1 } }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ value: 7, enumerable: true, configurable: true, writable: false }, {});
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | proxy-over | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = new Proxy({ value: 7, enumerable: true, configurable: true, writable: false }, {});
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | proxy-over | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, [["enumerable"].join("")]: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, [["enumerable"].join("")]: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, [["configurable"].join("")]: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, [["configurable"].join("")]: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, [["set"].join("")]: function (x) { this.y = x; } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, [["set"].join("")]: function (x) { this.y = x; } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, [["get"].join("")]: () => 7 };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, [["get"].join("")]: () => 7 };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, [["enumerable"].join("")]: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, [["enumerable"].join("")]: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, [["configurable"].join("")]: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, [["configurable"].join("")]: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, [["writable"].join("")]: true };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, [["writable"].join("")]: true };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, [["value"].join("")]: "text" };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, [["value"].join("")]: "text" };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, [["value"].join("")]: { deep: 1 } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, [["value"].join("")]: { deep: 1 } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, [["writable"].join("")]: false };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | computed-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, [["writable"].join("")]: false };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | computed-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ get: () => 7 }, { enumerable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ get: () => 7 }, { enumerable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ get: () => 7 }, { configurable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ get: () => 7 }, { configurable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ get: () => 7, enumerable: true }, { set: function (x) { this.y = x; } });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ get: () => 7, enumerable: true }, { set: function (x) { this.y = x; } });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ enumerable: true, configurable: true }, { get: () => 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ enumerable: true, configurable: true }, { get: () => 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ value: 7 }, { enumerable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ value: 7 }, { enumerable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ value: 7 }, { configurable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ value: 7 }, { configurable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ value: 7 }, { writable: true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ value: 7 }, { writable: true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ enumerable: true, writable: true }, { value: "text" });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ enumerable: true, writable: true }, { value: "text" });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ enumerable: true }, { value: { deep: 1 } });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ enumerable: true }, { value: { deep: 1 } });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ value: 7, enumerable: true, configurable: true }, { writable: false });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | assigned | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.assign({ value: 7, enumerable: true, configurable: true }, { writable: false });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | assigned | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, ...{ enumerable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, ...{ enumerable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, ...{ configurable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, ...{ configurable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, ...{ set: function (x) { this.y = x; } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { get: () => 7, enumerable: true, ...{ set: function (x) { this.y = x; } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, ...{ get: () => 7 } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, configurable: true, ...{ get: () => 7 } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, ...{ enumerable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, ...{ enumerable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, ...{ configurable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, ...{ configurable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, ...{ writable: true } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, ...{ writable: true } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, ...{ value: "text" } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, writable: true, ...{ value: "text" } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, ...{ value: { deep: 1 } } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { enumerable: true, ...{ value: { deep: 1 } } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, ...{ writable: false } };
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | spread | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = { value: 7, enumerable: true, configurable: true, ...{ writable: false } };
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | spread | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ get: () => 7 }, "enumerable", { get: () => true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ get: () => 7 }, "enumerable", { get: () => true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ get: () => 7 }, "configurable", { get: () => true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ get: () => 7 }, "configurable", { get: () => true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ get: () => 7, enumerable: true }, "set", { get: () => function (x) { this.y = x; } });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ get: () => 7, enumerable: true }, "set", { get: () => function (x) { this.y = x; } });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ enumerable: true, configurable: true }, "get", { get: () => () => 7 });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ enumerable: true, configurable: true }, "get", { get: () => () => 7 });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ value: 7 }, "enumerable", { get: () => true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ value: 7 }, "enumerable", { get: () => true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ value: 7 }, "configurable", { get: () => true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ value: 7 }, "configurable", { get: () => true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ value: 7 }, "writable", { get: () => true });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ value: 7 }, "writable", { get: () => true });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ enumerable: true, writable: true }, "value", { get: () => "text" });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ enumerable: true, writable: true }, "value", { get: () => "text" });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ enumerable: true }, "value", { get: () => { deep: 1 } });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ enumerable: true }, "value", { get: () => { deep: 1 } });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ value: 7, enumerable: true, configurable: true }, "writable", { get: () => false });
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | defined-getter | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = Object.defineProperty({ value: 7, enumerable: true, configurable: true }, "writable", { get: () => false });
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | defined-getter | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ get: () => 7 }, ["enumerable"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ get: () => 7 }, ["enumerable"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor enumerable true | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ get: () => 7 }, ["configurable"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ get: () => 7 }, ["configurable"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor configurable true | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = function (x) { this.y = x; }), d))({ get: () => 7, enumerable: true }, ["set"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = function (x) { this.y = x; }), d))({ get: () => 7, enumerable: true }, ["set"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor set function (x) { this.y = x; } | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = () => 7), d))({ enumerable: true, configurable: true }, ["get"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = () => 7), d))({ enumerable: true, configurable: true }, ["get"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | accessor get () => 7 | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ value: 7 }, ["enumerable"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ value: 7 }, ["enumerable"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data enumerable true | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ value: 7 }, ["configurable"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ value: 7 }, ["configurable"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data configurable true | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ value: 7 }, ["writable"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = true), d))({ value: 7 }, ["writable"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable true | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = "text"), d))({ enumerable: true, writable: true }, ["value"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = "text"), d))({ enumerable: true, writable: true }, ["value"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value \"text\" | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = { deep: 1 }), d))({ enumerable: true }, ["value"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = { deep: 1 }), d))({ enumerable: true }, ["value"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data value { deep: 1 } | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = false), d))({ value: 7, enumerable: true, configurable: true }, ["writable"].join(""));
    Object.defineProperty(o, "x", d);
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | stored-by-key | define-property:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
{
  function scene() {
    let o = {};
    const d = ((d, k) => ((d[k] = false), d))({ value: 7, enumerable: true, configurable: true }, ["writable"].join(""));
    Object.defineProperties(o, { x: d });
    const walked = [];
    for (const k in o) walked.push(k);
    console.log("empty | data writable false | stored-by-key | define-properties:", Object.keys(o).join(), "|", walked.join(), "|", JSON.stringify(o), "|", JSON.stringify({ ...o }), "|", JSON.stringify(Object.assign({}, o)), "|",
      Object.prototype.propertyIsEnumerable.call(o, "x"), attempt(() => ((o.x = 9), typeof o.x === "object" ? "object" : o.x)), o.y, attempt(() => delete o.x), "x" in o, typeof o.x);
  }
  scene();
}
