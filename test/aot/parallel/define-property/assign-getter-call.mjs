Object.assign(Event.prototype, { get laid() { return function () { return "mine"; }; } });
console.log(new CustomEvent("x").laid());
