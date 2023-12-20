/// <reference types='bun-types' />
import { pathToFileURL } from 'node:url';
import {
    type ElementHandlers as WASMElementHandlers,
    type DocumentHandlers as WASMDocumentHandlers,
    type HTMLRewriterOptions as WASMRewriterOptions,
    HTMLRewriter as WASMRewriter,
} from 'html-rewriter-wasm';
import { SyncWorker } from '../utils/sync.mjs';

import { createRequire } from 'node:module';
import { NotImplementedError } from '../utils/errors.js';
const require = createRequire(import.meta.url);

type BunElementHandlers = HTMLRewriterTypes.HTMLRewriterElementContentHandlers;
type BunDocumentHandlers = HTMLRewriterTypes.HTMLRewriterDocumentContentHandlers;
type BunRewriter = typeof HTMLRewriter;

type ElementHandlers = BunElementHandlers;
type DocumentHandlers = BunDocumentHandlers;

export const htmlRewriter = class HTMLRewriter {
    #elementHandlers: [selector: string, handlers: ElementHandlers][] = [];
    #documentHandlers: DocumentHandlers[] = [];
    readonly #options: WASMRewriterOptions;

    constructor(options: WASMRewriterOptions = {}) {
        this.#options = options;
    }
    on(selector: string, handlers: ElementHandlers): this {
        this.#elementHandlers.push([selector, handlers]);
        return this;
    }
    onDocument(handlers: DocumentHandlers): this {
        this.#documentHandlers.push(handlers);
        return this;
    }
    transform(input: Response): Response {
        throw new NotImplementedError('HTMLRewriter.transform', this.transform);
        // Well, I tried, this is a bit of a mess. I'm not sure how (if even possible) to get this to work.
        // As far as I can tell there is no way to make callbacks work across a worker boundary, given that
        // functions are not serializable, which is a problem when the callbacks are pretty much the entire
        // point of this class. Were Bun to make the transform function async, this would be a lot easier, but alas.
        /*const requireModules = { 'html-rewriter-wasm': pathToFileURL(require.resolve('html-rewriter-wasm')).href };
        const outerWorkerData = {
            thisOptions: this.#options,
            thisElementHandlers: this.#elementHandlers
                .map(([selector, handlers]) => [selector, Reflect.ownKeys(handlers) as (keyof typeof handlers)[]] as const),
            thisDocumentHandlers: this.#documentHandlers
                .map(handlers => Reflect.ownKeys(handlers) as (keyof typeof handlers)[]),
        };
        const worker = new SyncWorker(requireModules, outerWorkerData);
        const out = worker.sync(async (workerInput: ReadableStream<any>) => {
            const { workerData } = await import('node:worker_threads') as {
                workerData: typeof outerWorkerData & { resolve: Record<string, string>; };
            };
            const wasmrewriter = (await import(workerData.resolve['html-rewriter-wasm'])) as typeof import('html-rewriter-wasm');
            const WASMRewriter = wasmrewriter.HTMLRewriter;
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            const elmCallbacks: Record<string, Record<string, any>> = {};
            const docCallbacks: Record<string, any> = {};

            let output = '';
            const rewriter = new WASMRewriter((chunk) => output += decoder.decode(chunk), workerData.thisOptions);
            //for (const [selector, handlers] of workerData.thisElementHandlers) rewriter.on(selector, handlers as WASMElementHandlers);
            //for (const handlers of workerData.thisDocumentHandlers) rewriter.onDocument(handlers);
            for (const [selector, handlers] of workerData.thisElementHandlers) {
                rewriter.on(selector, {} as WASMElementHandlers);
            }
            for (const handlers of workerData.thisDocumentHandlers) {

            }

            const reader = workerInput.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    await rewriter.write(value);
                }
                //await rewriter.write(encoder.encode(workerInput));
                await rewriter.end();
                const encoded = encoder.encode(output);
                return encoded;
            } finally {
                rewriter.free();
                reader.releaseLock();
            }
        }, null)(input.body!);
        worker.terminate();
        return new Response(out);*/
    }
};

Object.defineProperty(globalThis, 'HTMLRewriter', {
    value: htmlRewriter satisfies BunRewriter,
    configurable: true, writable: true, enumerable: true,
});
