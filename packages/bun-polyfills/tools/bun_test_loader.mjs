// @ts-check
/// <reference types="typings-esm-loader" />
/// <reference types="bun-types" />
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import util from 'node:util';
import fs from 'node:fs';
import $ from 'chalk';
import bunwasm from 'bun-wasm';
import { TransformResponseStatus } from 'bun-wasm/schema';

await bunwasm.init();
const NO_STACK = () => void 0;
const decoder = new TextDecoder('utf-8');
const libRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'src');
const knownBunModules = ['sqlite', 'ffi', 'jsc', 'test'];
/** @type {string} */
let mainURL;

/** @type {resolve} */
export async function resolve(specifier, context, nextResolve) {
    if (context.parentURL === undefined) mainURL = specifier;
    if (specifier === 'bun') return { url: pathToFileURL(path.resolve(libRoot, 'modules', 'bun.js')).href, format: 'module', shortCircuit: true };
    if (specifier.startsWith('bun:')) {
        const module = specifier.slice(4);
        if (!knownBunModules.includes(module)) {
            const err = new Error(`[bun-polyfills] Unknown or unimplemented bun module "${specifier}"`);
            Error.captureStackTrace(err, NO_STACK);
            throw err;
        }
        if (module === 'sqlite') throw new Error('bun:sqlite polyfill is not implemented yet');
        return { url: pathToFileURL(path.resolve(libRoot, 'modules', module + '.js')).href, format: 'module', shortCircuit: true };
    }
    //console.debug('trying to resolve', specifier, 'from', context.parentURL);
    /** @type {Resolve.Return | Error} */
    let next;
    /** @type {string} */
    let format;
    try {
        next = await nextResolve(specifier, context);
        if (next.shortCircuit || next.format === 'builtin' || next.format === 'wasm') return next;
        specifier = next.url;
        format = next.format ?? 'module';
    } catch (err) {
        next = err;
        format = 'module';
    }
    //console.debug('resolved', specifier, 'from', context.parentURL, 'to', Reflect.get(next, 'url') ?? next);
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file://')) {
        if (!specifier.startsWith('file://')) {
            const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
            specifier = pathToFileURL(path.resolve(path.dirname(parent), specifier)).href;
        }
        const specifierPath = fileURLToPath(specifier);
        const exists = fs.existsSync(specifierPath);
        if (specifier.endsWith('.ts') && exists) return { url: specifier, format: 'ts' + format, shortCircuit: true };
        if (specifier.endsWith('.js') && exists) return { url: specifier, format, shortCircuit: true };
        if (specifier.endsWith('.ts') && fs.existsSync(specifierPath.slice(0, -3) + '.js')) return { url: specifier.slice(0, -3) + '.js', format, shortCircuit: true };
        if (specifier.endsWith('.js') && fs.existsSync(specifierPath.slice(0, -3) + '.ts')) return { url: specifier.slice(0, -3) + '.ts', format: 'ts' + format, shortCircuit: true };
        if (fs.existsSync(specifierPath + '.ts')) return { url: specifier + '.ts', format: 'ts' + format, shortCircuit: true };
        if (fs.existsSync(specifierPath + '.js')) return { url: specifier + '.js', format, shortCircuit: true };
        if (fs.existsSync(specifierPath + '.json')) return { url: specifier + '.json', format: 'json', shortCircuit: true };
        if (fs.existsSync(specifierPath + '/index.ts')) return { url: specifier + '/index.ts', format: 'ts' + format, shortCircuit: true };
        if (fs.existsSync(specifierPath + '/index.js')) return { url: specifier + '/index.js', format, shortCircuit: true };
        if (fs.existsSync(specifierPath + '/index.json')) return { url: specifier + '/index.json', format: 'json', shortCircuit: true };
    }
    if (next instanceof Error) throw next;
    else return next;
}

/** @type {load} */
export async function load(url, context, nextLoad) {
    //console.debug('Loading', url, 'with context', context);
    if (context.format === 'tsmodule' || context.format === 'tscommonjs') {
        const filepath = fileURLToPath(url);
        const src = fs.readFileSync(filepath, 'utf-8');
        const transform = bunwasm.transformSync(src, path.basename(filepath), 'ts');
        if (transform.status === TransformResponseStatus.fail) {
            if (transform.errors.length) {
                throw formatBuildErrors(transform.errors);
            } else {
                const err = new Error('Unknown transform error');
                Error.captureStackTrace(err, NO_STACK);
                throw err;
            }
        }
        return {
            shortCircuit: true,
            format: /** @type {ModuleFormat} */(context.format.slice(2)),
            source: decoder.decode(transform.files[0].data),
        };
    }
    if (context.format === 'json') context.importAssertions.type = 'json';
    const loaded = await nextLoad(url, context);
    if (url.startsWith('file://') && loaded.format === 'module') {
        const src = typeof loaded.source === 'string' ? loaded.source : decoder.decode(loaded.source);
        return { shortCircuit: true, format: 'module', source: src };
    }
    else return loaded;
}

/** @param {import('bun-wasm/schema').Message[]} buildErrors */
function formatBuildErrors(buildErrors) {
    const formatted = buildErrors.map(err => {
        const loc = err.data.location;
        const str = `${$.redBright('error')}${$.gray(':')} ${$.bold(err.data.text)}\n` +
        (loc
            ? `${highlightErrorChar(loc.line_text, loc.column)}\n` +
                $.redBright.bold('^'.padStart(loc.column)) + '\n' +
                `${$.bold(loc.file)}${$.gray(':')}${$.yellowBright(loc.line)}${$.gray(':')}${$.yellowBright(loc.column)} ${$.gray(loc.offset)}`
            : ''
        );
        const newerr = new Error(str);
        newerr.name = 'BuildError';
        newerr.stack = str;
        return newerr;
    });
    const aggregate = new AggregateError(formatted, `Input code has ${formatted.length} error${formatted.length === 1 ? '' : 's'}`);
    Error.captureStackTrace(aggregate, NO_STACK);
    aggregate.name = 'BuildFailed';
    return aggregate;
}

/**
 * @param {string} str
 * @param {number} at */
function highlightErrorChar(str, at) {
    return str.slice(0, at) + $.red(str[at]) + str.slice(at + 1);
}
