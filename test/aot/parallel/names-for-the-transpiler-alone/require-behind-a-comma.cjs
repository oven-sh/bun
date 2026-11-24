// The transpiler drops what stands in front of the comma, and reads the name in the call of `require` that is left.
console.log(typeof (0, require)("bun:os").EOL);
