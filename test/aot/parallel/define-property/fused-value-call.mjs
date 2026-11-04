Object.defineProperties(Event.prototype, Object.getOwnPropertyDescriptors({ laid: function () { return "mine"; } }));
console.log(new CustomEvent("x").laid());
