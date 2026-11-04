const key = Bun.inspect[["cus", "tom"].join("")];
console.log({ [key]: (depth, options, inspect) => "computed name: " + inspect({ a: 1 }) });
