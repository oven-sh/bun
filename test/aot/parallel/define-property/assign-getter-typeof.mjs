Object.assign(Event.prototype, { get laid() { return { deep: function () { return 1; } }; } });
console.log(typeof new CustomEvent("x").laid.deep);
