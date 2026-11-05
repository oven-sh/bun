const custom = Symbol.for("nodejs.util.inspect.custom");
function lay(define, target) { define(target, custom, { value: () => "laid" }); return target; }
console.log(lay(Object.defineProperty, {}));
