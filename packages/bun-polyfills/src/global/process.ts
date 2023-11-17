
if (typeof process === 'object' && process !== null) {
    // process polyfills (node-only)
    Reflect.set(process, 'isBun', 1 satisfies Process['isBun']);
    Reflect.set(process, 'browser', false satisfies Process['browser']);

    const NULL_VERSION = '0'.repeat(39) + '1';
    /** @start_generated_code */
    process.versions.boringssl = 'b275c5ce1c88bc06f5a967026d3c0ce1df2be815' satisfies Process['versions'][string];
    process.versions.libarchive = 'dc321febde83dd0f31158e1be61a7aedda65e7a2' satisfies Process['versions'][string];
    process.versions.mimalloc = '7968d4285043401bb36573374710d47a4081a063' satisfies Process['versions'][string];
    process.versions.picohttpparser = '066d2b1e9ab820703db0837a7255d92d30f0c9f5' satisfies Process['versions'][string];
    process.versions.webkit = 'a780bdf0255ae1a7ed15e4b3f31c14af705facae' satisfies Process['versions'][string];
    process.versions.tinycc = '2d3ad9e0d32194ad7fd867b66ebe218dcc8cb5cd' satisfies Process['versions'][string];
    process.versions.lolhtml = '8d4c273ded322193d017042d1f48df2766b0f88b' satisfies Process['versions'][string];
    process.versions.c_ares = '0e7a5dee0fbb04080750cf6eabbe89d8bae87faa' satisfies Process['versions'][string];
    process.versions.zig = '0.12.0-dev.1604+caae40c21' satisfies Process['versions'][string];
    process.versions.bun = '1.0.13' satisfies Process['versions'][string];
    Reflect.set(process, 'revision', '222bfda9cc2a5b22d737e4657246e3127600fb09' satisfies Process['revision']);
    /** @end_generated_code */

    // Doesn't work on Windows sadly
    //Object.defineProperty(process, 'execPath', { value: path.resolve(root, 'cli.js') });
}
