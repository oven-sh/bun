function gauge() {}
gauge.tag = "above";
Object.defineProperties(gauge, { label: { get() { return this.tag + ":" + typeof this.extra; } } });
class Fine extends gauge { static tag = "below"; static extra() {} }
console.log(gauge.label, Fine.label);
