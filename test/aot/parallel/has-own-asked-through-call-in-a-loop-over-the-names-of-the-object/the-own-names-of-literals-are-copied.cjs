"use strict";
var hasOwnProperty = Object.prototype.hasOwnProperty;
function copy(config) { var props = {}, name; for (name in config) hasOwnProperty.call(config, name) && "key" !== name && "__self" !== name && (props[name] = config[name]); return props; }
let said = 0;
for (let turn = 0; turn < 20000; turn++) { const made = copy(turn % 3 === 0 ? { key: turn, label: "a", size: turn & 7 } : turn % 3 === 1 ? { size: 2, wide: true } : { label: "b" }); said = (said + Object.keys(made).length * 7 + (made.size | 0)) % 1000003; }
console.log(said);
