console.log({ get [Symbol.for("nodejs.util.inspect.custom")]() { return (depth, options, inspect) => "out of a getter: " + inspect({ a: 1 }); } });
