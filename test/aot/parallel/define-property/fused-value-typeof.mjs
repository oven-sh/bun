Object.defineProperties(Event.prototype, Object.getOwnPropertyDescriptors({ laid: { deep: function () { return 1; } } }));
console.log(typeof new CustomEvent("x").laid.deep);
