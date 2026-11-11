function* relay() { return Object.getOwnPropertyNames(arguments).join(",") + ":" + typeof Object.getOwnPropertyDescriptor(arguments, "callee").value; }
console.log(relay(4, 5).next().value);
