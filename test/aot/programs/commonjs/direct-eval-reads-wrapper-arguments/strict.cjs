"use strict";
console.log(eval("arguments.length"), eval("arguments[0] === exports"));
eval("arguments[0] = 'stored by the text'");
console.log(exports === module.exports, eval("arguments[0]"));
console.log(((text) => eval(text))("arguments.length"));
