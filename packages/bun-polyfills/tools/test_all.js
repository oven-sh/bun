// @ts-nocheck allowImportingTsExtensions
// Run with "bun run test-all"

await import('../../../test/js/bun/console/console-iterator.test.ts');
await import('../../../test/js/bun/dns/resolve-dns.test.ts');
await import('../../../test/js/bun/ffi/ffi.test.js');
// TODO: http
await import('../../../test/js/bun/io/bun-write.test.js');
await import('../../../test/js/bun/jsc/bun-jsc.test.js');
// TODO: net
// plugin: N/A
await import('../../../test/js/bun/spawn/exit-code.test.ts');
await import('../../../test/js/bun/spawn/spawn-streaming-stdin.test.ts');
await import('../../../test/js/bun/spawn/spawn-streaming-stdout.test.ts');
await import('../../../test/js/bun/spawn/spawn.test.ts');
await import('../../../test/js/bun/sqlite/sqlite.test.ts');
// stream: N/A
// test: N/A
await import('../../../test/js/bun/util/arraybuffersink.test.ts');
await import('../../../test/js/bun/util/bun-file-exists.test.js');
await import('../../../test/js/bun/util/bun-isMainThread.test.js');
await import('../../../test/js/bun/util/concat.test.js');
await import('../../../test/js/bun/util/error-gc-test.test.js');
await import('../../../test/js/bun/util/escapeHTML.test.js');
await import('../../../test/js/bun/util/file-type.test.ts');
await import('../../../test/js/bun/util/filesink.test.ts');
await import('../../../test/js/bun/util/fileUrl.test.js');
await import('../../../test/js/bun/util/hash.test.js');
await import('../../../test/js/bun/util/index-of-line.test.ts');
//await import('../../../test/js/bun/util/inspect.test.js'); //? Can't run because of JSX :(
await import('../../../test/js/bun/util/mmap.test.js');
await import('../../../test/js/bun/util/password.test.ts');
await import('../../../test/js/bun/util/peek.test.ts');
await import('../../../test/js/bun/util/readablestreamtoarraybuffer.test.ts');
await import('../../../test/js/bun/util/sleepSync.test.ts');
await import('../../../test/js/bun/util/unsafe.test.js');
await import('../../../test/js/bun/util/which.test.ts');
// TODO: websocket
await import('../../../test/js/bun/globals.test.js');
// this test has to be last to run due to some weird sync/async issues with the polyfills' test runner
await import('../../../test/js/bun/resolve/import-meta.test.js');

export { };
