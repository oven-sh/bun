const thing = new Proxy({ size: 1 }, { get(target, key) { return key === Symbol.for("nodejs.util.inspect.custom") ? () => "custom " + target.size : target[key]; } });
console.log(thing);
