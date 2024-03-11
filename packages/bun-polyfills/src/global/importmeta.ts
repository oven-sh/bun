import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Without an ESM loader, this polyfill is impossible to apply automatically,
// due to the per-module nature of import.meta. In order to use this polyfill,
// you must import it in every module that uses import.meta, and call it with
// the import.meta object as the argument. When the polyfills are integrated
// with bun build, this could be done automatically by the build process at
// the top of every module file bundled.

export default function polyfillImportMeta(metaIn: ImportMeta) {
    const require2 = createRequire(metaIn.url);
    const metapath = fileURLToPath(metaIn.url);
    const meta: ImportMeta = {
        url: metaIn.url,
        main: metapath === process.argv[1],
        path: metapath,
        dir: path.dirname(metapath),
        file: path.basename(metapath),
        require: require2,
        resolve: metaIn.resolve,
        resolveSync(id: string, parent?: string) {
            return require2.resolve(id, {
                paths: typeof parent === 'string' ? [
                    path.resolve(parent.startsWith('file://') ? fileURLToPath(parent) : parent, '..')
                ] : undefined,
            });
        },
    };
    Object.assign(metaIn, meta);
}
