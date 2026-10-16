// `super` in an arrow function in a computed key belongs to the method around the literal, not to the literal.
console.log({ __proto__: { s: "outer" }, m() { return Object.keys({ __proto__: { s: "inner" }, [(() => super.s)()]() {} })[0]; } }.m());
