function gauge() {}
gauge.helper = function () { return "helped"; };
Object.defineProperties(gauge, { label: { get() { return this.helper(); } } });
console.log(gauge.label);
