var log = require("./report.cjs").log;

exports.notLists = [
  ["a string", function () { return "12"; }],
  ["an array-like object", function () { return { 0: 1, 1: 2, length: 2 }; }],
  ["an arguments object", function () { return (function () { return arguments; })(1, 2); }],
  ["holes", function () { return new Array(2); }],
  ["null", function () { return null; }],
];

exports.notNumbers = [
  ["a numeric string", function () { return "3"; }],
  ["an object with valueOf", function () { return { valueOf: function () { log.push("valueOf"); return 3; } }; }],
  ["a BigInt", function () { return 3n; }],
  ["two to the 32nd and one", function () { return 4294967297; }],
  ["negative zero", function () { return -0; }],
  ["undefined", function () { return undefined; }],
];

exports.notPoints = [
  ["the other key order", function () { return { y: 1, x: 3 }; }],
  ["getters", function () { return { get y() { log.push("y"); return 1; }, get x() { log.push("x"); return 3; } }; }],
  ["strings inside", function () { return { x: "3", y: "1" }; }],
  ["y is missing", function () { return { x: 3 }; }],
  ["a number", function () { return 5; }],
  ["null", function () { return null; }],
];

exports.notTexts = [
  ["an array", function () { return ["a"]; }],
  ["a String object", function () { return new String("ab"); }],
  ["an object with the method", function () { return { toUpperCase: function () { return "its own answer"; } }; }],
  ["a number", function () { return 5; }],
];
