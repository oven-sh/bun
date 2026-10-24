// An export is a plain data property.
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(require("./a.cjs"), "x")));
