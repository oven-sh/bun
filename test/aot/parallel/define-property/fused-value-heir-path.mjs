Object.defineProperties(Event.prototype.preventDefault, Object.getOwnPropertyDescriptors({ laid: function () { return "mine"; } }));
function read() { return CustomEvent.prototype.preventDefault.laid; }
console.log(read()());
