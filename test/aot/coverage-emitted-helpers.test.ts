// The helpers that tsc, Babel and esbuild print count as called.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "private.js": `"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldIn = (this && this.__classPrivateFieldIn) || function(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Counter = void 0;
var _Counter_n, _Counter_instances, _Counter_bump;
class Counter {
    constructor(n) {
        _Counter_instances.add(this);
        _Counter_n.set(this, 0);
        __classPrivateFieldSet(this, _Counter_n, n, "f");
    }
    get value() {
        return __classPrivateFieldGet(this, _Counter_n, "f");
    }
    up() {
        __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_bump).call(this);
        return this;
    }
    static is(it) {
        return __classPrivateFieldIn(_Counter_n, it);
    }
}
exports.Counter = Counter;
_Counter_n = new WeakMap(), _Counter_instances = new WeakSet(), _Counter_bump = function _Counter_bump() {
    __classPrivateFieldSet(this, _Counter_n, __classPrivateFieldGet(this, _Counter_n, "f") + 1, "f");
};
`,
  "kind.js": `"use strict";
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
exports.kind = function kind(x) {
    return _typeof(x);
};
`,
  "fields.js": `var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
export class A {
    constructor() {
        __publicField(this, "x", 1);
    }
}
`,
  "required.js": `"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.r = void 0;
const b_1 = __importDefault(require("./b.js"));
exports.r = b_1.default.b;
`,
  "b.js": `module.exports = { b: 1 };
`,
  "helpers.test.js": `import { expect, test } from "bun:test";
import { A } from "./fields.js";
import { kind } from "./kind.js";
import { Counter } from "./private.js";
import { r } from "./required.js";
test("helpers", () => {
  expect([new Counter(1).up().value, Counter.is(new Counter(2)), kind(1), new A().x, r]).toEqual([2, true, "number", 1, 1]);
});
`,
  "bunfig.toml": `[test]
coverageSkipTestFiles = true
`,
};

async function report(flags: string[]) {
  using directory = tempDir("aot-coverage-emitted-helpers", files);
  const { stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "--coverage", "--coverage-reporter=lcov"],
    String(directory),
    bunEnv,
  );
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
  return readFileSync(join(String(directory), "coverage", "lcov.info"), "utf8");
}

test("a compiled run counts the helpers that it calls", async () => {
  const [plain, compiled] = await Promise.all([report([]), report(["--aot"])]);
  expect(plain).toContain("private.js");
  expect(compiled).toBe(plain);
});
