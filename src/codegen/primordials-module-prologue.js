// GENERATED FILE — do not edit. See src/codegen/generate-primordials.ts.
//
// Node.js's `primordials` object, for modules ported from Node's lib/: the same
// member names and call semantics as lib/internal/per_context/primordials.js
// (uncurried prototype methods, XGetY/XSetY accessors, *Apply variants for
// varargs methods, Safe* classes, hardenRegExp, promise helpers). Everything is
// built from JSC's link-time constants ($Name), which the engine captures before
// user code can run, so nothing here reads a global at load time. Spec constants
// (constructor lengths, Math/Number constants, BYTES_PER_ELEMENT, ...) are inlined
// as literals instead of read at runtime.
//
// This object exists for Node compatibility; Bun's own modules should use the
// $Name constants and intrinsics directly rather than going through it.

// (thisArg, ...args) => func.call(thisArg, ...args) without touching
// Function.prototype: bind and call are both pristine link-time constants.
const uncurryThis = $FunctionPrototypeBind.$call($FunctionPrototypeBind, $FunctionPrototypeCall);

// applyBind(func) => (thisArg, args) => func.apply(thisArg, args);
// applyBind(func, receiver) binds the receiver as `this` (static methods).
const applyBind = $FunctionPrototypeBind.$call($FunctionPrototypeBind, $FunctionPrototypeApply);
