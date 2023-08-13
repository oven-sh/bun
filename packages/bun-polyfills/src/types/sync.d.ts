// This file explicitly redefines global types used in order to enforce the correct types,
// regardless of the arbitrary order in which TSC/TSServer decide to load the type libraries in.
// Annoyingly, even this file can sometimes break, so if your types are inverted, try restarting TSServer.

import '@types/node';

declare module 'stream/web' {
    interface ReadableStreamDefaultReader {
        readMany(): Promise<ReadableStreamDefaultReadManyResult<any>>;
    }
}

declare global {
    var performance: typeof import('perf_hooks').performance;

    // TODO: These should be contributed to @types/node upstream
    namespace NodeJS {
        interface CallSite {
            getScriptNameOrSourceURL(): string;
            getEnclosingColumnNumber(): number;
            getEnclosingLineNumber(): number;
            getPosition(): number;
            getPromiseIndex(): number;
            getScriptHash(): string;
            isAsync(): boolean;
            isPromiseAll(): boolean;
            toString(): string;
        }
    }
}
