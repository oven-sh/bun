"use strict";

var AssertionError;
function loadAssertionError() {
  if (AssertionError === undefined) {
    AssertionError = require("internal/assert/assertion_error");
  }
}

export function innerOk(fn, argLen, value, message) {
  if (!value) {
    let generatedMessage = false;

    if (argLen === 0) {
      generatedMessage = true;
      message = "No value argument passed to `assert.ok()`";
    } else if (message == null) {
      generatedMessage = true;
      message = undefined;
    } else if (Error.isError(message)) {
      throw message;
    }

    if (AssertionError === undefined) loadAssertionError();
    const err = new AssertionError({
      actual: value,
      expected: true,
      message,
      operator: "==",
      stackStartFn: fn,
    });
    err.generatedMessage = generatedMessage;
    throw err;
  }
}
