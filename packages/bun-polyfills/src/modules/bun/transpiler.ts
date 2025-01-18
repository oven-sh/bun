import type { JavaScriptLoader, TranspilerOptions, Transpiler as BunTranspiler, Import } from 'bun';
import { transformSync, scan, init } from 'bun-wasm';
import { Message } from 'bun-wasm/schema';
import $ from 'chalk';

await init();

enum InternalImportKind {
    'entry-point-run' = 1, // entry_point_run
    'entry-point-build' = 2, // entry_point_build
    'import-statement' = 3, // stmt
    'require-call' = 4, // require
    'dynamic-import' = 5, // dynamic
    'require-resolve' = 6, // require_resolve
    'import-rule' = 7, // at
    'url-token' = 8, // url
    'internal' = 9, // internal
}

export type ScanImportsEntry = {
    kind: 'import-statement' | 'dynamic-import';
    path: string;
};

export default class Transpiler implements BunTranspiler {
    constructor(options?: TranspilerOptions) {
        this.#options = options ?? {};
        this.#rootFile = 'input.tsx'; // + (this.#options.loader ?? 'tsx');
        //? ^ NOTE: with current bun-wasm builds, the loader option is ignored and hardcoded to tsx
    }
    #options: TranspilerOptions;
    #rootFile: string;
    #decoder?: TextDecoder;
    #internallyCalled: boolean = false;

    async transform(code: StringOrBuffer, loader: JavaScriptLoader): Promise<string> {
        this.#internallyCalled = true;
        return this.transformSync(code, loader);
    }

    transformSync(code: StringOrBuffer, ctx: object): string;
    transformSync(code: StringOrBuffer, loader: JavaScriptLoader, ctx: object): string;
    transformSync(code: StringOrBuffer, loader?: JavaScriptLoader | undefined): string;
    transformSync(code: StringOrBuffer, loader?: JavaScriptLoader | object, ctx: object = {}): string {
        if (!code) return ''; // wasm dies with empty string input
        if (typeof code !== 'string' && !(code instanceof Uint8Array)) throw new TypeError('code must be a string or Uint8Array');
        if (typeof loader !== 'string') loader = this.#options.loader;
        const result = transformSync(code, this.#rootFile, loader);
        // status 1 = success, status 2 = error
        if (result.status === 2) throw formatBuildErrors(result.errors, this.#internallyCalled ? this.transform : this.transformSync);
        this.#internallyCalled = false;
        this.#decoder ??= new TextDecoder();
        return this.#decoder.decode(result.files[0].data);
    }

    scan(code: StringOrBuffer): { exports: string[]; imports: Import[]; } {
        if (!code) return { exports: [], imports: [] }; // wasm dies with empty string input
        if (typeof code !== 'string' && !(code instanceof Uint8Array)) throw new TypeError('code must be a string or Uint8Array');

        const result = scan(code, this.#rootFile, this.#options.loader);
        if (result.errors.length) throw formatBuildErrors(result.errors, this.#internallyCalled ? this.scanImports : this.scan);
        this.#internallyCalled = false;

        result.imports.forEach(imp => (imp.kind as unknown) = InternalImportKind[imp.kind]);
        return {
            exports: result.exports,
            imports: result.imports as unknown as Import[],
        };
    }

    scanImports(code: StringOrBuffer): ScanImportsEntry[] {
        this.#internallyCalled = true;
        return this.scan(code).imports.filter(imp => imp.kind === 'import-statement' || imp.kind === 'dynamic-import') as ScanImportsEntry[];
    }
}

function formatBuildErrors(buildErrors: Message[], caller: Transpiler[keyof Transpiler]): AggregateError {
    const formatted = buildErrors.map(err => {
        const loc = err.data.location;
        const str = `${$.redBright('error')}${$.gray(':')} ${$.bold(err.data.text)}\n` +
        (loc
            ? `${highlightErrorChar(loc.line_text, loc.offset)}\n` +
                $.redBright.bold('^'.padStart(loc.column)) + '\n' +
                `${$.bold(loc.file)}${$.gray(':')}${$.yellowBright(loc.line)}${$.gray(':')}${$.yellowBright(loc.column)} ${$.gray(loc.offset)}`
            : ''
        );
        return { __proto__: Error.prototype, stack: str };
    });
    const aggregate = new AggregateError(formatted, `Input code has ${formatted.length} error${formatted.length === 1 ? '' : 's'}`);
    Error.captureStackTrace(aggregate, caller);
    aggregate.name = 'BuildError';
    return aggregate;
}

function highlightErrorChar(str: string, at: number): string {
    return str.slice(0, at) + $.red(str[at]) + str.slice(at + 1);
}
