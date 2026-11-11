// The literal writes `value` twice: what is written last is the member itself: the definition changes nothing, and the build says so.
Object.defineProperty(Math, "min", { value() {}, ...{ value: Math.min } });
console.log(Math.min(1, 2));
