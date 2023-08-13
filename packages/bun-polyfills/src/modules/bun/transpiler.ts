import type { JavaScriptLoader, TranspilerOptions, Transpiler as BunTranspiler, Import } from 'bun';
import { NotImplementedError } from '../../utils/errors.js';

// TODO: Possible implementation with WASM builds of bun with just the transpiler?
// NOTE: This is possible to implement with something like SWC, and was previously done,
// but it has lots of quirks due to the differences between SWC and Bun, so the plan is
// to not do that unless there is actual demand for using Bun.Transpiler in Node.js before
// the WASM build is worked on. The signatures are here for now as a placeholder.

export default class Transpiler implements BunTranspiler {
    constructor(options?: TranspilerOptions) {
        this.#options = options ?? {};
    }

    async transform(code: StringOrBuffer, loader: JavaScriptLoader): Promise<string> {
        if (typeof code !== 'string') code = new TextDecoder().decode(code);
        throw new NotImplementedError('Bun.Transpiler', this.transform);
    }

    transformSync(code: StringOrBuffer, ctx: object): string;
    transformSync(code: StringOrBuffer, loader: JavaScriptLoader, ctx: object): string;
    transformSync(code: StringOrBuffer, loader?: JavaScriptLoader | undefined): string;
    transformSync(code: StringOrBuffer, loader?: JavaScriptLoader | object, ctx: object = {}): string {
        if (typeof code !== 'string') code = new TextDecoder().decode(code);
        if (typeof loader !== 'string') loader = 'js';
        throw new NotImplementedError('Bun.Transpiler', this.transformSync);
    }

    scan(code: StringOrBuffer): { exports: string[]; imports: Import[]; } {
        if (typeof code !== 'string') code = new TextDecoder().decode(code);
        throw new NotImplementedError('Bun.Transpiler', this.scan);
        //return {
        //    imports: this.scanImports(code),
        //    exports: this.#scanExports(code)
        //};
    }

    scanImports(code: StringOrBuffer): {
        kind: 'import-statement' | 'dynamic-import';
        path: string;
    }[] {
        if (typeof code !== 'string') code = new TextDecoder().decode(code);
        throw new NotImplementedError('Bun.Transpiler', this.scanImports);
        //const imports: { kind: 'import-statement' | 'dynamic-import', path: string }[] = [];
        //this.#scanTopLevelImports(code).forEach(x => imports.push({ kind: 'import-statement', path: x }));
        //this.#scanDynamicImports(code).forEach(x => imports.push({ kind: 'dynamic-import', path: x }));
        //return imports;
    }

    /*#scanDynamicImports(code: string): string[] {
        return this.parseSync(code, {
            syntax: this.#syntax, target: 'es2022', tsx: this.#options.loader === 'tsx'
        }).body.filter(x => x.type === 'ExpressionStatement' && x.expression.type === 'CallExpression' && x.expression.callee.type === 'Import')
            .map(i => (((i as swc.ExpressionStatement).expression as swc.CallExpression).arguments[0].expression as swc.StringLiteral).value);
    }*/

    /*#scanTopLevelImports(code: string): string[] {
        return this.parseSync(code, {
            syntax: this.#syntax, target: 'es2022', tsx: this.#options.loader === 'tsx'
        }).body.filter(x => x.type === 'ImportDeclaration' || x.type === 'ExportAllDeclaration' || x.type === 'ExportNamedDeclaration')
            .filter(i => !(i as swc.ImportDeclaration).typeOnly)
            .map(i => (i as swc.ImportDeclaration).source.value);
    }*/

    /*#scanExports(code: string, includeDefault: boolean = false): string[] {
        const parsed = this.parseSync(code, {
            syntax: this.#syntax, target: 'es2022', tsx: this.#options.loader === 'tsx'
        }).body;
        const exports = [];
        exports.push(parsed.filter(x => x.type === 'ExportDeclaration' && !x.declaration.declare)
            .flatMap(i => ((i as swc.ExportDeclaration).declaration as swc.ClassDeclaration).identifier?.value ??
                ((i as swc.ExportDeclaration).declaration as swc.VariableDeclaration).declarations.map(d => (d.id as swc.Identifier).value)
            )
        );
        exports.push(parsed.filter(x => x.type === 'ExportNamedDeclaration')
            .flatMap(i => (i as swc.ExportNamedDeclaration).specifiers
                .filter(s => s.type === 'ExportSpecifier' && !s.isTypeOnly)
                .map(s => (s as swc.NamedExportSpecifier).exported?.value ?? (s as swc.NamedExportSpecifier).orig.value)
            )
        );
        if (includeDefault) exports.push(this.#scanDefaultExport(code) ?? []);
        return exports.flat();
    }*/

    /*#scanDefaultExport(code: string): 'default' | undefined {
        const parsed = this.parseSync(code, {
            syntax: this.#syntax, target: 'es2022', tsx: this.#options.loader === 'tsx'
        }).body;
        
        const defaultExportDecl = parsed.find(x => x.type === 'ExportDefaultDeclaration') as swc.ExportDefaultDeclaration | undefined;
        if (!defaultExportDecl) {
            const defaultExportExpr = parsed.find(x => x.type === 'ExportDefaultExpression') as swc.ExportDefaultExpression | undefined;
            if (!defaultExportExpr) return undefined;
            if (!defaultExportExpr.expression.type.startsWith('Ts')) return 'default';
            else return undefined;
        }

        if (!defaultExportDecl.decl.type.startsWith('Ts') && !Reflect.get(defaultExportDecl.decl, 'declare')) return 'default';
        else return undefined;
    }*/

    #options: TranspilerOptions;
}
