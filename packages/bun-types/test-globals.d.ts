// Do not include this file in ./index.d.ts
//
// This file gets loaded by developers including the following triple slash directive:
//
// ```ts
// /// <reference types="bun/test-globals" />
// ```

declare var test: typeof import("bun:test").test;
declare var it: typeof import("bun:test").it;
declare var describe: typeof import("bun:test").describe;
declare var expect: typeof import("bun:test").expect;
declare var beforeAll: typeof import("bun:test").beforeAll;
declare var beforeEach: typeof import("bun:test").beforeEach;
declare var afterEach: typeof import("bun:test").afterEach;
declare var afterAll: typeof import("bun:test").afterAll;
declare var setDefaultTimeout: typeof import("bun:test").setDefaultTimeout;
declare var mock: typeof import("bun:test").mock;
declare var spyOn: typeof import("bun:test").spyOn;
declare var jest: typeof import("bun:test").jest;
