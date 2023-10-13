/*! Modified version of: to-sync. MIT License. Jimmy Wärting <https://jimmy.warting.se/opensource> */
// @ts-check
import { Worker } from 'node:worker_threads';

/**
 * Why are we here? Just to suffer?
 * 
 * This abomination of a class allows you to call an async function... synchronously.
 * 
 * This is used for polyfills that are sync in Bun but need async functions in Node to work.
 * So far all polyfills that needed this were fairly performance-insensitive, so it was fine, but
 * if you need to use this for something that needs to be fast, you should probably reconsider.
 * 
 * ## Usage Rules
 * - The called function MUST follow the constraints of code running in a worker thread.
 * - The called function MUST be async. If a non-async function is called and throws an error, there will be a hang.
 * - The called function MUST return a `Uint8Array` or a superclass.
 * - The called function MUST not import external modules by name (See below).
 * - Remember to `terminate()` the worker when you're done with it.
 * 
 * ## External Modules
 * External modules are ones in `node_modules`, Node builtins and file imports are both fine, but for external modules
 * you need to pass a map of module names to their fully resolved absolute file URLs to the SyncWorker constructor, as
 * workers can't resolve modules by name themselves. Use `require.resolve` or `import.meta.resolve` to get the absolute file URL of a module.
 */
export class SyncWorker extends Worker {
    /**
     * @param {Record<string, string>=} modules Map of external module names to their fully resolved absolute file URLs,
     * use in the worker code as `workerData.resolve.{moduleName}`
     * @param {Record<string, unknown>=} workerData Extra data to pass to the worker thread
     * @param {AbortSignal=} signal Terminate the worker thread if a signal is aborted
     */
    constructor(modules = {}, workerData = {}, signal) {
        // Create the worker thread
        const mod = new URL('sync_worker.mjs', import.meta.url);
        super(mod, { workerData: { ...workerData, resolve: modules } });

        super.on('error', console.error);
        super.on('messageerror', console.error);

        // Create a shared buffer to communicate with the worker thread
        this.#ab = new SharedArrayBuffer(8192);
        this.#data = new Uint8Array(this.#ab, 8);
        this.#int32 = new Int32Array(this.#ab);

        signal?.addEventListener('abort', () => super.terminate());
    }
    #ab;
    #data;
    #int32;

    /**
     * Read the notes on the {@link SyncWorker} class before using this.
     * @template {(...args: any[]) => any} I
     * @template {((result: Uint8Array) => any) | null} F
     * @param {I} fn
     * @param {F} formatter
     * @returns {(...args: Parameters<I>) => F extends null ? (ReturnType<I> extends Promise<infer V> ? V : ReturnType<I>) : ReturnType<F>}
     */
    sync(fn, formatter) {
        const source = 'export default ' + fn.toString();
        const mc = new MessageChannel();
        const localPort = mc.port1;
        const remotePort = mc.port2;
        super.postMessage({ port: remotePort, code: source, ab: this.#ab }, [remotePort]);
        
        return (/** @type {unknown[]} */ ...args) => {
            Atomics.store(this.#int32, 0, 0);
            localPort.postMessage(args); // Send the arguments to the worker thread
            Atomics.wait(this.#int32, 0, 0); // Wait for the worker thread to send the result back
            // Two first values in the shared buffer are the number of bytes left to read and
            // the second value is a boolean indicating if the result was successful or not.
            let bytesLeft = this.#int32[0];
            const ok = this.#int32[1];
            if (bytesLeft === -1) return new Uint8Array(0);

            // Allocate a new Uint8Array to store the result
            const result = new Uint8Array(bytesLeft);
            let offset = 0;

            // Read the result from the shared buffer
            while (bytesLeft > 0) {
                // Read all the data that is available in the SharedBuffer
                const part = this.#data.subarray(0, Math.min(bytesLeft, this.#data.byteLength));
                result.set(part, offset); // Copy the data to the result
                offset += part.byteLength; // Update the offset
                if (offset === result.byteLength) break; // If we have read all the data, break the loop
                Atomics.notify(this.#int32, 0); // Notify the worker thread that we are ready to receive more data
                Atomics.wait(this.#int32, 0, bytesLeft); // Wait for the worker thread to send more data
                bytesLeft -= part.byteLength; // Update the number of bytes left to read
            }

            if (ok) return formatter ? formatter(result) : result;

            const str = new TextDecoder().decode(result);
            const err = JSON.parse(str);
            const error = new Error(err.message);
            error.stack = err.stack
                ?.replace(/ \(data:text\/javascript,.+:(\d+):(\d+)\)$/gm, ' (sync worker thread:$1:$2)')
                ?.replace(/at data:text\/javascript,.+:(\d+):(\d+)$/gm, 'at (sync worker thread:$1:$2)');
            throw error;
        };
    };
}
