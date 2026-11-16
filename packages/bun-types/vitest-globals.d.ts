// Do not include this file in ./index.d.ts
//
// Types for the globals that `bun test` defines when bunfig.toml has `globals = "vitest"`. Use it instead of
// "vitest/globals" once the `vitest` package is uninstalled. It also loads ./vitest.d.ts.
//
// Developers load this file with the following triple-slash directive:
//
// ```ts
// /// <reference types="bun-types/vitest-globals" />
// ```

/// <reference path="./vitest.d.ts" />

declare var test: typeof import("vitest").test;
declare var it: typeof import("vitest").it;
declare var describe: typeof import("vitest").describe;
declare var suite: typeof import("vitest").suite;
declare var expect: typeof import("vitest").expect;
declare var expectTypeOf: typeof import("vitest").expectTypeOf;
declare var assertType: typeof import("vitest").assertType;
declare var vi: typeof import("vitest").vi;
declare var vitest: typeof import("vitest").vitest;
declare var beforeAll: typeof import("vitest").beforeAll;
declare var beforeEach: typeof import("vitest").beforeEach;
declare var afterEach: typeof import("vitest").afterEach;
declare var afterAll: typeof import("vitest").afterAll;
declare var aroundEach: typeof import("vitest").aroundEach;
declare var aroundAll: typeof import("vitest").aroundAll;
declare var onTestFinished: typeof import("vitest").onTestFinished;
declare var onTestFailed: typeof import("vitest").onTestFailed;
