const o = {};
o.__defineGetter__(Symbol.for("nodejs.util.inspect.custom"), () => () => "got");
console.log(o);
