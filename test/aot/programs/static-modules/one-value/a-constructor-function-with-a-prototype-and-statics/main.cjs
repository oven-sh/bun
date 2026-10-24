// The usual form of an older package: a constructor function, methods on its prototype, a static, and the function once more under its own name.
const Emitter = require("./emitter.cjs");
const { Emitter: Named } = require("./emitter.cjs");
const emitter = new Emitter();
const heard = [];
emitter.on("greet", word => heard.push(word)).on("greet", word => heard.push(word));
console.log(emitter.emit("greet", "hello"), Emitter.defaultMax, Named === Emitter, emitter instanceof Named);
console.log(heard.join(), Emitter.name, Object.keys(Emitter).join());
