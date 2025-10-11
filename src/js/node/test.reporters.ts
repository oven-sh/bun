// Hardcoded module "node:test/reporters"

const ObjectDefineProperties = Object.defineProperties;

let dot;
let junit;
let spec;
let tap;
let lcov;

const default_exports = {};
ObjectDefineProperties(default_exports, {
  dot: {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() {
      dot ??= require("internal/test/reporter/dot");
      return dot;
    },
  },
  junit: {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() {
      junit ??= require("internal/test/reporter/junit");
      return junit;
    },
  },
  spec: {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: function value() {
      spec ??= require("internal/test/reporter/spec");
      return new spec(...arguments);
    },
  },
  tap: {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() {
      tap ??= require("internal/test/reporter/tap");
      return tap;
    },
  },
  lcov: {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: function value() {
      lcov ??= require("internal/test/reporter/lcov");
      return new lcov(...arguments);
    },
  },
});

export default default_exports;
