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
// These two tests below are quite slow (60+ seconds combined) so I'm skipping them for now.
//await import('../../../test/js/bun/spawn/spawn-streaming-stdin.test.ts');
//await import('../../../test/js/bun/spawn/spawn-streaming-stdout.test.ts');
await import('../../../test/js/bun/spawn/spawn.test.ts');
await import('../../../test/js/bun/sqlite/sqlite.test.ts');
// stream
// test
// util
// websocket
// globals

// this test has to be last to run due to some weird sync/async issues with the polyfills' test runner
await import('../../../test/js/bun/resolve/import-meta.test.js');

export { };
