// Transcribed from Source/JavaScriptCore/builtins/PromiseConstructor.js. `new.target` is the constructor the realm started with.
// $resolvePromise() and $rejectPromise() do nothing to a promise that one of the two was called on before.

declare function $newPromise<T>(): Promise<T>;
declare function $resolvePromise(promise: unknown, resolution: unknown): undefined;
declare function $rejectPromise(promise: unknown, reason: unknown): undefined;
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;

export function Promise$construct<T>(executor: unknown): Promise<T> {
    if (typeof executor !== "function") throw new TypeError("Promise constructor takes a function argument");
    const promise = $newPromise<T>();
    try {
        $call<unknown>(executor, undefined, (resolution: unknown) => $resolvePromise(promise, resolution), (reason: unknown) => $rejectPromise(promise, reason));
    } catch (error) {
        $rejectPromise(promise, error);
    }
    return promise;
}
