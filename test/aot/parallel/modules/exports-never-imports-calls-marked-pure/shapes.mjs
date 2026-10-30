export const made = [];
export const weak = [];
function make(name, inner) { made.push(name); const shape = { name, inner }; weak.push(new WeakRef(shape)); return shape; }
export const marked = /* @__PURE__ */ make("marked");
export const nested = /* @__PURE__ */ make("outer", /* @__PURE__ */ make("inner"));
export const plain = make("plain");
export const used = /* @__PURE__ */ make("used");
