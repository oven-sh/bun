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
    const require = createRequire(metaIn.url);
    const meta = metaIn as Mutable<ImportMeta>;

    meta.path = fileURLToPath(meta.url);
    meta.dir = path.dirname(meta.path);
    meta.file = path.basename(meta.path);
    meta.require = require;
    meta.resolve = async (id: string, parent?: string) => meta.resolveSync(id, parent);
    meta.resolveSync = (id: string, parent?: string) => require.resolve(id, {
        paths: typeof parent === 'string' ? [
            path.resolve(parent.startsWith('file://') ? fileURLToPath(parent) : parent, '..')
        ] : undefined,
    });
}
