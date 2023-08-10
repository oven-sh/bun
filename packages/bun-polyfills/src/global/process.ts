
if (typeof process === 'object' && process !== null) {
    // process polyfills (node-only)
    Reflect.set(process, 'isBun', 1 satisfies Process['isBun']);
    Reflect.set(process, 'browser', false satisfies Process['browser']);

    const NULL_VERSION = '0'.repeat(39) + '1';
    process.versions.bun = '0.7.1' satisfies Process['versions'][string]; // TODO: This can probably be fetched from somewhere in the repo
    process.versions.webkit = NULL_VERSION satisfies Process['versions'][string];
    process.versions.mimalloc = NULL_VERSION satisfies Process['versions'][string];
    process.versions.libarchive = NULL_VERSION satisfies Process['versions'][string];
    process.versions.picohttpparser = NULL_VERSION satisfies Process['versions'][string];
    process.versions.boringssl = NULL_VERSION satisfies Process['versions'][string];
    process.versions.zig = '0.10.0' satisfies Process['versions'][string];
    Reflect.set(process, 'revision', NULL_VERSION satisfies Process['revision']);

    // Doesn't work on Windows sadly
    //Object.defineProperty(process, 'execPath', { value: path.resolve(root, 'cli.js') });
}
