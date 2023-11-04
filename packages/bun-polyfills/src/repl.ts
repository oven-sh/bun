import bun from './index.js';
import * as jsc from './modules/jsc.js';
import * as ffi from './modules/ffi.js';

// This file serves two purposes:
// 1. It is the entry point for using the Bun global in the REPL. (--import this file)
// 2. It makes TypeScript check the full structural compatibility of the Bun global vs the polyfills object,
//    which allows for the type assertion below to be used as a TODO list index.

globalThis.Bun = bun as typeof bun & {
    // TODO: Missing polyfills
    build: typeof import('bun').build;
    FileSystemRouter: typeof import('bun').FileSystemRouter;
};

Reflect.set(globalThis, 'jsc', jsc);
Reflect.set(globalThis, 'ffi', ffi);
