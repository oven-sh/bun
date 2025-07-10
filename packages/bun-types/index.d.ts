// Project: https://github.com/oven-sh/bun
// Definitions by: Bun Contributors <https://github.com/oven-sh/bun/graphs/contributors>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="node" />

/// <reference path="./globals.d.ts" />
/// <reference path="./s3.d.ts" />
/// <reference path="./fetch.d.ts" />
/// <reference path="./bun.d.ts" />
/// <reference path="./extensions.d.ts" />
/// <reference path="./devserver.d.ts" />
/// <reference path="./ffi.d.ts" />
/// <reference path="./html-rewriter.d.ts" />
/// <reference path="./jsc.d.ts" />
/// <reference path="./sqlite.d.ts" />
/// <reference path="./test.d.ts" />
/// <reference path="./wasm.d.ts" />
/// <reference path="./overrides.d.ts" />
/// <reference path="./deprecated.d.ts" />
/// <reference path="./redis.d.ts" />
/// <reference path="./shell.d.ts" />
/// <reference path="./experimental.d.ts" />
/// <reference path="./serve.d.ts" />

/// <reference path="./bun.ns.d.ts" />

// We must declare that `onmessage` exists globally since many of Node's declarations
// fallback to the globally available versions when, which Bun overrides. It detects
// if the symbols are available by looking for a declaration of `onmessage`.
declare var onmessage: Bun.__internal.UseLibDomIfAvailable<"onmessage", never>;
