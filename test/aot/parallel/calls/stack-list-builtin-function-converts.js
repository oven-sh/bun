// Stack traces list the built in function that converts an operand.
"use strict";
// Each function calls a built-in function that converts an operand, and the conversion throws or runs a function of the program. Every row prints the names that the stack trace lists, the built-in function's own among them.
const namesIn = stack =>
  String(stack)
    .split("\n")
    .slice(1)
    .map(line => /at (\S+)/.exec(line)?.[1])
    .filter(name => name && !name.includes("/") && !name.includes(":"))
    .join(" < ");
function row(label, run) {
  try {
    console.log(label + ":", run());
  } catch (error) {
    console.log(label + ":", error.constructor.name, "|", namesIn(error.stack));
  }
}
const looks = {
  valueOf() {
    return namesIn(new Error("looks").stack).length;
  },
  toString() {
    return namesIn(new Error("looks").stack);
  },
};

for (let turn = 0; turn < 2; turn++) {
  row("Object.keys, kept", function keptKeys(o = null) {
    const keys = Object.keys(o);
    return keys.length;
  });
  row("Object.keys, returned", function returnedKeys(o = null) {
    return Object.keys(o);
  });
  row("Number, kept", function keptNumber() {
    const number = Number(Symbol());
    return number + 1;
  });
  row("Number, returned", function returnedNumber() {
    return Number(Symbol());
  });
  row("Math.max, kept", function keptMax() {
    const max = Math.max(Symbol(), 1);
    return max + 1;
  });
  row("Math.max, returned", function returnedMax() {
    return Math.max(Symbol(), 1);
  });
  row("concat, kept", function keptConcat() {
    const text = "a".concat(Symbol());
    return text + 1;
  });
  row("concat, returned", function returnedConcat() {
    return "a".concat(Symbol());
  });
  row("concat of an object that looks, kept", function keptLook() {
    const text = "".concat(looks);
    return text + ".";
  });
  row("concat of an object that looks, returned", function returnedLook() {
    return "".concat(looks);
  });
  row("Math.abs of an object that looks, kept", function keptAbs() {
    const length = Math.abs(looks);
    return length + 0;
  });
  row("Math.abs of an object that looks, returned", function returnedAbs() {
    return Math.abs(looks);
  });
}
