// Test CallSite API fixes

const originalPrepare = Error.prepareStackTrace;

// Test 1: getFunctionName should return null for anonymous functions
Error.prepareStackTrace = (err, stack) => stack;
const anonymousFunc = function() {
  return new Error().stack;
};
const stack1 = anonymousFunc();
Error.prepareStackTrace = originalPrepare;
console.log("Anonymous function name:", stack1[0].getFunctionName(), "(should be null)");

// Test 2: getMethodName should return null for anonymous methods
Error.prepareStackTrace = (err, stack) => stack;
const obj = {
  method: function() {
    return new Error().stack;
  }
};
const stack2 = obj.method();
Error.prepareStackTrace = originalPrepare;
console.log("Anonymous method name:", stack2[0].getMethodName(), "(should be null or method name)");

// Test 3: getTypeName for undefined (strict mode)
Error.prepareStackTrace = (err, stack) => stack;
"use strict";
function strictFunc() {
  return new Error().stack;
}
const stack3 = strictFunc();
Error.prepareStackTrace = originalPrepare;
console.log("Strict function getTypeName:", stack3[0].getTypeName(), "(should be null)");

// Test 4: isAsync for async functions
Error.prepareStackTrace = (err, stack) => stack;
async function asyncFunc() {
  return new Error().stack;
}
const stack4Prom = asyncFunc();
stack4Prom.then(stack4 => {
  Error.prepareStackTrace = originalPrepare;
  console.log("Async function isAsync:", stack4[0].isAsync(), "(should be true)");
  
  // Test 5: isAsync for regular functions
  Error.prepareStackTrace = (err, stack) => stack;
  function regularFunc() {
    return new Error().stack;
  }
  const stack5 = regularFunc();
  Error.prepareStackTrace = originalPrepare;
  console.log("Regular function isAsync:", stack5[0].isAsync(), "(should be false)");
  
  // Test 6: isToplevel for nested functions
  Error.prepareStackTrace = (err, stack) => stack;
  function innerFunc() {
    return new Error().stack;
  }
  function outerFunc() {
    return innerFunc();
  }
  const stack6 = outerFunc();
  Error.prepareStackTrace = originalPrepare;
  console.log("Inner function isToplevel:", stack6[0].isToplevel(), "(should be false)");
  console.log("Outer function isToplevel:", stack6[1].isToplevel(), "(should be false)");
  
  // Test 7: All methods present
  const cs = stack6[0];
  console.log("\nAll CallSite methods present:");
  console.log("  getThis:", typeof cs.getThis === "function");
  console.log("  getTypeName:", typeof cs.getTypeName === "function");
  console.log("  getFunction:", typeof cs.getFunction === "function");
  console.log("  getFunctionName:", typeof cs.getFunctionName === "function");
  console.log("  getMethodName:", typeof cs.getMethodName === "function");
  console.log("  getFileName:", typeof cs.getFileName === "function");
  console.log("  getLineNumber:", typeof cs.getLineNumber === "function");
  console.log("  getColumnNumber:", typeof cs.getColumnNumber === "function");
  console.log("  getEvalOrigin:", typeof cs.getEvalOrigin === "function");
  console.log("  getScriptNameOrSourceURL:", typeof cs.getScriptNameOrSourceURL === "function");
  console.log("  isToplevel:", typeof cs.isToplevel === "function");
  console.log("  isEval:", typeof cs.isEval === "function");
  console.log("  isNative:", typeof cs.isNative === "function");
  console.log("  isConstructor:", typeof cs.isConstructor === "function");
  console.log("  isAsync:", typeof cs.isAsync === "function");
  console.log("  isPromiseAll:", typeof cs.isPromiseAll === "function");
  console.log("  getPromiseIndex:", typeof cs.getPromiseIndex === "function");
  console.log("  toString:", typeof cs.toString === "function");
});