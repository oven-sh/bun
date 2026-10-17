declare function $newPromise<T>(): Promise<T>;
declare function $resolvePromise(promise: unknown, resolution: unknown): undefined;
declare function $rejectPromise(promise: unknown, reason: unknown): undefined;
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $tryNewPromiseSubclass(parent: unknown, newTarget: unknown, executor: unknown): unknown;
declare function $superConstruct(classObject: unknown, newTarget: unknown, args: unknown[], parent: unknown): unknown;
declare function $getIterator(iterable: unknown): unknown;
declare function $isUnmodifiedGenerator(value: unknown): boolean;
declare function $drivenIteratorMarker(): unknown;

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

export function Promise$runExecutorOfSubclass(promise: unknown, executor: unknown): unknown {
    try {
        $call<unknown>(executor, undefined, (resolution: unknown) => $resolvePromise(promise, resolution), (reason: unknown) => $rejectPromise(promise, reason));
    } catch (error) {
        $rejectPromise(promise, error);
    }
    return promise;
}

export function Promise$constructSubclass(classObject: unknown, newTarget: unknown, parent: unknown, executor: unknown): unknown {
    const promise = $tryNewPromiseSubclass(parent, newTarget, executor);
    return promise === undefined ? $superConstruct(classObject, newTarget, [executor], parent) : Promise$runExecutorOfSubclass(promise, executor);
}

export function Promise$constructSubclassWithList(classObject: unknown, newTarget: unknown, parent: unknown, list: unknown[]): unknown {
    const executor = list.length > 0 ? list[0] : undefined;
    const promise = $tryNewPromiseSubclass(parent, newTarget, executor);
    return promise === undefined ? $superConstruct(classObject, newTarget, list, parent) : Promise$runExecutorOfSubclass(promise, executor);
}

export function openDelegatedIterator(iterable: unknown): unknown {
    if ($isUnmodifiedGenerator(iterable)) return iterable;
    if (iterable === undefined || iterable === null) return $getIterator(iterable);
    const method: unknown = (iterable as any)[Symbol.iterator];
    if (typeof method !== "function") throw new TypeError("Spread syntax requires ...iterable[Symbol.iterator] to be a function");
    const iterator = $call<unknown>(method, iterable);
    if ((typeof iterator !== "object" || iterator === null) && typeof iterator !== "function") throw new TypeError("Iterator result interface is not an object.");
    return iterator;
}

export function nextMethodOfDelegatedIterator(iterator: unknown): unknown {
    return $isUnmodifiedGenerator(iterator) ? $drivenIteratorMarker() : (iterator as any).next;
}

export function iteratorMethodOf(iterable: unknown): unknown {
    return (iterable as any)[Symbol.iterator];
}

export function openDelegatedIteratorWith(iterable: unknown, method: unknown): unknown {
    const iterator = $call<unknown>(method, iterable);
    if ((typeof iterator !== "object" || iterator === null) && typeof iterator !== "function") throw new TypeError("Iterator result interface is not an object.");
    return iterator;
}
