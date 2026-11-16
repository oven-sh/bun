exports.make = size => ({ size, [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } });
