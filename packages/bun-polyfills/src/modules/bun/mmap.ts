import fs from 'fs';
type mmapper = typeof import('mmap-utils')['default'];
type MapProtectionFlags = Parameters<mmapper['map']>[1];

let mmapper: mmapper | null = null;
try {
    // TS is having some trouble resolving these types properly, it thinks the module is on .default.default (???)
    mmapper = (await import('mmap-utils')).default as unknown as mmapper;
} catch {
    // Error will be thrown when mmap is used
}

//? The opts object may also support "size" and "offset" properties, but these are not documented in bun-types yet.
export const mmap: typeof Bun.mmap = (path, opts = {}): Uint8Array => {
    if (!mmapper) {
        const err = new Error('Bun.mmap is not available due to uninitialized mmapper dependency.');
        Error.captureStackTrace(err, mmap);
        throw err;
    }
    if (opts.shared === undefined) opts.shared = true;
    if (opts.sync === undefined) opts.sync = false;
    //? The sync option is ignored by Bun on MacOS and errors on Linux, so might as well just ignore it for now.
    //if (opts.sync) throw new NotImplementedError('Bun.mmap(..., { sync: true })', mmap);

    const fd = fs.openSync(path as fs.PathLike, 'r+');
    const size = fs.fstatSync(fd).size;
    return mmapper.map(
        size,
        <MapProtectionFlags>(mmapper.PROT_READ | mmapper.PROT_WRITE),
        opts.shared ? mmapper.MAP_SHARED : mmapper.MAP_PRIVATE,
        fd
    );
};
