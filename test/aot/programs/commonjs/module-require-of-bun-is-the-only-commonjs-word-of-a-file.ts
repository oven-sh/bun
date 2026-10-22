// Nothing else in the file says CommonJS, and the transpiler reads neither `module` nor `require` here.
console.log(module.require("bun").color("red", "hex"));
