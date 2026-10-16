// Transcribed from Source/JavaScriptCore/builtins/ArrayPrototype.js and ArrayConstructor.js. `a` is an array that had its original structure when the function was entered.
//
// A loop comes three times: for an ArrayWithDouble, for an ArrayWithInt32 or ArrayWithContiguous, and for whatever the array has become. The first two test, before
// the loop and before every element, that the array still is what they are for and still has the element, and are left for the third where it is not. They call
// nothing but the callback, so where that is inlined and harmless the back end finds every test but the first redundant.

declare function $hasIndex(a: unknown, k: number): boolean;
declare function $getIndex<T>(a: unknown, k: number): T;
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $callNoInline<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $isOriginalArray(x: unknown): boolean;
declare function $isDoubleArray(a: unknown[]): boolean;
declare function $isContiguousArray(a: unknown[]): boolean;
declare function $getDoubleIndex(a: unknown[], k: number): number;
declare function $hasContiguousIndex(a: unknown[], k: number): boolean;
declare function $getContiguousIndex<T>(a: unknown[], k: number): T;
declare function $newArrayWithSpecies<T>(n: number, a: unknown[] | undefined): T[];
declare function $newArrayWithCapacity<T>(n: number, a: unknown[]): T[];
declare function $tryPutByValDirect(out: unknown[], k: number, value: unknown): boolean;
declare function $truncateNewArray<T>(out: T[], n: number): T[];
declare function $newDoubleArray(n: number): number[];
declare function $newContiguousArray<T>(n: number): T[];
declare function $putDoubleIndex(out: unknown[], k: number, value: number): void;
declare function $putContiguousIndex(out: unknown[], k: number, value: unknown): void;
declare function $growNewArray(out: unknown[], n: number): void;
declare function $tryPutIndex(a: unknown[], k: number, value: unknown): boolean;
declare function $isPlainArrayLike(x: unknown): boolean;

function isCallable(f: unknown): boolean {
    return typeof f === "function";
}

function isArray(x: unknown): boolean {
    return Array.isArray(x);
}

function isDoubleArray(a: unknown[]): boolean {
    return $isDoubleArray(a);
}

function isContiguousArray(a: unknown[]): boolean {
    return $isContiguousArray(a);
}

function toLength(value: unknown): number {
    const n = +(value as any);
    if (!(n > 0)) return 0;
    return n >= 9007199254740991 ? 9007199254740991 : Math.floor(n);
}

function saysLess(answer: unknown): boolean {
    if (typeof answer === "number") return answer < 0;
    if (typeof answer === "boolean") return !answer;
    return +(answer as any) < 0;
}

function restOfForEach<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): void {
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (has) $callNoInline<unknown>(f, thisArg, $getIndex<T>(a, k), k, a);
    }
}

export function Array$forEach<T>(a: T[], f: unknown, thisArg: unknown): void {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.forEach callback must be a function");
    const m = a.length;
    let k = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x) $call<unknown>(f, thisArg, x, k, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) $call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k, a);
        }
    }
    if (k < n) restOfForEach(a, f, thisArg, k, n);
}

function restOfMap<T, U>(a: T[], f: unknown, thisArg: unknown, out: U[], k: number, n: number): void {
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (has) out[k] = $callNoInline<U>(f, thisArg, $getIndex<T>(a, k), k, a);
    }
}

export function Array$map<T, U>(a: T[], f: unknown, thisArg: unknown): U[] {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.map callback must be a function");
    const out: U[] = $newArrayWithSpecies<U>(n, a);
    const m = a.length;
    let k = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) continue;
            const y = $call<U>(f, thisArg, x, k, a);
            const isStored: boolean = $tryPutByValDirect(out, k, y);
            if (!isStored) {
                out[k++] = y;
                break;
            }
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) continue;
            const y = $call<U>(f, thisArg, $getContiguousIndex<T>(a, k), k, a);
            const isStored: boolean = $tryPutByValDirect(out, k, y);
            if (!isStored) {
                out[k++] = y;
                break;
            }
        }
    }
    if (k < n) restOfMap(a, f, thisArg, out, k, n);
    return $truncateNewArray<U>(out, n);
}

export function Array$mapByNumber<T>(a: T[], f: unknown, thisArg: unknown): unknown[] {
    const n = a.length;
    const out: unknown[] = $newArrayWithSpecies<unknown>(n, a);
    let k = 0;
    if (isDoubleArray(a)) {
        for (; k < n; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) continue;
            const isStored: boolean = $tryPutByValDirect(out, k, x as unknown);
            if (!isStored) break;
        }
    } else if (isContiguousArray(a)) {
        for (; k < n; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) continue;
            const x = $getContiguousIndex<unknown>(a, k);
            let y: unknown;
            if (typeof x === "string") y = Number(x);
            else if (typeof x === "number") y = x;
            else break;
            const isStored: boolean = $tryPutByValDirect(out, k, y);
            if (!isStored) break;
        }
    }
    if (k < n) restOfMap(a, f, thisArg, out, k, n);
    return $truncateNewArray<unknown>(out, n);
}

function restOfFilter<T>(a: T[], f: unknown, thisArg: unknown, out: T[], to: number, k: number, n: number): number {
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (!has) continue;
        const x = $getIndex<T>(a, k);
        if ($callNoInline<unknown>(f, thisArg, x, k, a)) {
            out[to] = x;
            to = (to + 1) >>> 0;
        }
    }
    return to;
}

export function Array$filter<T>(a: T[], f: unknown, thisArg: unknown): T[] {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.filter callback must be a function");
    const out: T[] = $newArrayWithCapacity<T>(n, a);
    const m = a.length;
    let k = 0;
    let to = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) continue;
            if (!$call<unknown>(f, thisArg, x, k, a)) continue;
            const isStored: boolean = $tryPutByValDirect(out, to, x);
            if (!isStored) {
                out[to] = x as unknown as T;
                to = (to + 1) >>> 0;
                k++;
                break;
            }
            to = (to + 1) >>> 0;
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) continue;
            const x = $getContiguousIndex<T>(a, k);
            if (!$call<unknown>(f, thisArg, x, k, a)) continue;
            const isStored: boolean = $tryPutByValDirect(out, to, x);
            if (!isStored) {
                out[to] = x;
                to = (to + 1) >>> 0;
                k++;
                break;
            }
            to = (to + 1) >>> 0;
        }
    }
    if (k < n) to = restOfFilter(a, f, thisArg, out, to, k, n) >>> 0;
    return $truncateNewArray<T>(out, to);
}

export function Array$filterTruthy<T>(a: T[], f: unknown, thisArg: unknown): T[] {
    const n = a.length;
    const out: T[] = $newArrayWithCapacity<T>(n, a);
    let k = 0;
    let to = 0;
    if (isDoubleArray(a)) {
        for (; k < n; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (!x) continue;
            const isStored: boolean = $tryPutByValDirect(out, to, x);
            if (!isStored) break;
            to = (to + 1) >>> 0;
        }
    } else if (isContiguousArray(a)) {
        for (; k < n; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) continue;
            const x = $getContiguousIndex<T>(a, k);
            if (!x) continue;
            const isStored: boolean = $tryPutByValDirect(out, to, x);
            if (!isStored) break;
            to = (to + 1) >>> 0;
        }
    }
    if (k < n) to = restOfFilter(a, f, thisArg, out, to, k, n) >>> 0;
    return $truncateNewArray<T>(out, to);
}

function restOfSome<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): boolean {
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (has && $callNoInline<unknown>(f, thisArg, $getIndex<T>(a, k), k, a)) return true;
    }
    return false;
}

export function Array$some<T>(a: T[], f: unknown, thisArg: unknown): boolean {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.some callback must be a function");
    const m = a.length;
    let k = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x && $call<unknown>(f, thisArg, x, k, a)) return true;
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has && $call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k, a)) return true;
        }
    }
    return k < n && restOfSome(a, f, thisArg, k, n);
}

function restOfEvery<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): boolean {
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (has && !$callNoInline<unknown>(f, thisArg, $getIndex<T>(a, k), k, a)) return false;
    }
    return true;
}

export function Array$every<T>(a: T[], f: unknown, thisArg: unknown): boolean {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.every callback must be a function");
    const m = a.length;
    let k = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x && !$call<unknown>(f, thisArg, x, k, a)) return false;
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has && !$call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k, a)) return false;
        }
    }
    return k >= n || restOfEvery(a, f, thisArg, k, n);
}

function restOfFind<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): T | undefined {
    for (; k < n; k++) {
        const x = $getIndex<T>(a, k);
        if ($callNoInline<unknown>(f, thisArg, x, k, a)) return x;
    }
    return undefined;
}

export function Array$find<T>(a: T[], f: unknown, thisArg: unknown): T | undefined {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.find callback must be a function");
    const m = a.length;
    let k = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) break;
            if ($call<unknown>(f, thisArg, x, k, a)) return x as unknown as T;
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) break;
            const x = $getContiguousIndex<T>(a, k);
            if ($call<unknown>(f, thisArg, x, k, a)) return x;
        }
    }
    return k < n ? restOfFind(a, f, thisArg, k, n) : undefined;
}

function restOfFindLast<T>(a: T[], f: unknown, thisArg: unknown, k: number): T | undefined {
    for (; k >= 0; k--) {
        const x = $getIndex<T>(a, k);
        if ($callNoInline<unknown>(f, thisArg, x, k, a)) return x;
    }
    return undefined;
}

export function Array$findLast<T>(a: T[], f: unknown, thisArg: unknown): T | undefined {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.findLast callback must be a function");
    let k = n - 1;
    if (isDoubleArray(a)) {
        for (; k >= 0 && isDoubleArray(a) && k < a.length; k--) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) break;
            if ($call<unknown>(f, thisArg, x, k, a)) return x as unknown as T;
        }
    } else if (isContiguousArray(a)) {
        for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) break;
            const x = $getContiguousIndex<T>(a, k);
            if ($call<unknown>(f, thisArg, x, k, a)) return x;
        }
    }
    return k >= 0 ? restOfFindLast(a, f, thisArg, k) : undefined;
}

function restOfFindIndex<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): number {
    for (; k < n; k++) {
        if ($callNoInline<unknown>(f, thisArg, $getIndex<T>(a, k), k, a)) return k;
    }
    return -1;
}

export function Array$findIndex<T>(a: T[], f: unknown, thisArg: unknown): number {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.findIndex callback must be a function");
    const m = a.length;
    let k = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) break;
            if ($call<unknown>(f, thisArg, x, k, a)) return k;
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) break;
            if ($call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k, a)) return k;
        }
    }
    return k < n ? restOfFindIndex(a, f, thisArg, k, n) : -1;
}

function restOfFindLastIndex<T>(a: T[], f: unknown, thisArg: unknown, k: number): number {
    for (; k >= 0; k--) {
        if ($callNoInline<unknown>(f, thisArg, $getIndex<T>(a, k), k, a)) return k;
    }
    return -1;
}

export function Array$findLastIndex<T>(a: T[], f: unknown, thisArg: unknown): number {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.findLastIndex callback must be a function");
    let k = n - 1;
    if (isDoubleArray(a)) {
        for (; k >= 0 && isDoubleArray(a) && k < a.length; k--) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) break;
            if ($call<unknown>(f, thisArg, x, k, a)) return k;
        }
    } else if (isContiguousArray(a)) {
        for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) break;
            if ($call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k, a)) return k;
        }
    }
    return k >= 0 ? restOfFindLastIndex(a, f, thisArg, k) : -1;
}

function restOfReduce<T>(a: T[], f: unknown, acc: unknown, k: number, n: number): unknown {
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (has) acc = $callNoInline<unknown>(f, undefined, acc, $getIndex<T>(a, k), k, a);
    }
    return acc;
}

// While what is accumulated is a number it is kept as one.
export function Array$reduce<T, A>(a: T[], f: unknown, initial: A): A {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.reduce callback must be a function");
    let k = 0;
    let acc: unknown = initial;
    const m = a.length;
    if (typeof acc === "number") {
        let sum: number = acc;
        let isSum = true;
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) continue;
                const r = $call<unknown>(f, undefined, sum, x, k, a);
                if (typeof r !== "number") {
                    acc = r;
                    isSum = false;
                    k++;
                    break;
                }
                sum = r;
            }
        } else if (isContiguousArray(a)) {
            for (; k < m && isContiguousArray(a) && k < a.length; k++) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (!has) continue;
                const r = $call<unknown>(f, undefined, sum, $getContiguousIndex<T>(a, k), k, a);
                if (typeof r !== "number") {
                    acc = r;
                    isSum = false;
                    k++;
                    break;
                }
                sum = r;
            }
        }
        if (isSum) acc = sum;
    } else if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x) acc = $call<unknown>(f, undefined, acc, x, k, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) acc = $call<unknown>(f, undefined, acc, $getContiguousIndex<T>(a, k), k, a);
        }
    }
    if (k < n) acc = restOfReduce(a, f, acc, k, n);
    return acc as A;
}

export function Array$reduceWithoutInitialValue<T>(a: T[], f: unknown): T {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.reduce callback must be a function");
    let k = 0;
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (has) break;
    }
    if (k >= n) throw new TypeError("reduce of empty array with no initial value");
    let acc: unknown = $getIndex<T>(a, k);
    k++;
    const m = a.length;
    if (typeof acc === "number") {
        let sum: number = acc;
        let isSum = true;
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) continue;
                const r = $call<unknown>(f, undefined, sum, x, k, a);
                if (typeof r !== "number") {
                    acc = r;
                    isSum = false;
                    k++;
                    break;
                }
                sum = r;
            }
        } else if (isContiguousArray(a)) {
            for (; k < m && isContiguousArray(a) && k < a.length; k++) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (!has) continue;
                const r = $call<unknown>(f, undefined, sum, $getContiguousIndex<T>(a, k), k, a);
                if (typeof r !== "number") {
                    acc = r;
                    isSum = false;
                    k++;
                    break;
                }
                sum = r;
            }
        }
        if (isSum) acc = sum;
    } else if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x) acc = $call<unknown>(f, undefined, acc, x, k, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) acc = $call<unknown>(f, undefined, acc, $getContiguousIndex<T>(a, k), k, a);
        }
    }
    if (k < n) acc = restOfReduce(a, f, acc, k, n);
    return acc as T;
}

function restOfReduceRight<T>(a: T[], f: unknown, acc: unknown, k: number): unknown {
    for (; k >= 0; k--) {
        const has: boolean = $hasIndex(a, k);
        if (has) acc = $callNoInline<unknown>(f, undefined, acc, $getIndex<T>(a, k), k, a);
    }
    return acc;
}

export function Array$reduceRight<T, A>(a: T[], f: unknown, initial: A): A {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.reduceRight callback must be a function");
    let k = n - 1;
    let acc: unknown = initial;
    if (typeof acc === "number") {
        let sum: number = acc;
        let isSum = true;
        if (isDoubleArray(a)) {
            for (; k >= 0 && isDoubleArray(a) && k < a.length; k--) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) continue;
                const r = $call<unknown>(f, undefined, sum, x, k, a);
                if (typeof r !== "number") {
                    acc = r;
                    isSum = false;
                    k--;
                    break;
                }
                sum = r;
            }
        } else if (isContiguousArray(a)) {
            for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (!has) continue;
                const r = $call<unknown>(f, undefined, sum, $getContiguousIndex<T>(a, k), k, a);
                if (typeof r !== "number") {
                    acc = r;
                    isSum = false;
                    k--;
                    break;
                }
                sum = r;
            }
        }
        if (isSum) acc = sum;
    } else if (isDoubleArray(a)) {
        for (; k >= 0 && isDoubleArray(a) && k < a.length; k--) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x) acc = $call<unknown>(f, undefined, acc, x, k, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) acc = $call<unknown>(f, undefined, acc, $getContiguousIndex<T>(a, k), k, a);
        }
    }
    if (k >= 0) acc = restOfReduceRight(a, f, acc, k);
    return acc as A;
}

export function Array$reduceRightWithoutInitialValue<T>(a: T[], f: unknown): T {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.reduceRight callback must be a function");
    let k = n - 1;
    for (; k >= 0; k--) {
        const has: boolean = $hasIndex(a, k);
        if (has) break;
    }
    if (k < 0) throw new TypeError("reduceRight of empty array with no initial value");
    let acc: unknown = $getIndex<T>(a, k);
    k--;
    if (typeof acc === "number") {
        let sum: number = acc;
        let isSum = true;
        if (isDoubleArray(a)) {
            for (; k >= 0 && isDoubleArray(a) && k < a.length; k--) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) continue;
                const r = $call<unknown>(f, undefined, sum, x, k, a);
                if (typeof r !== "number") {
                    acc = r;
                    isSum = false;
                    k--;
                    break;
                }
                sum = r;
            }
        } else if (isContiguousArray(a)) {
            for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (!has) continue;
                const r = $call<unknown>(f, undefined, sum, $getContiguousIndex<T>(a, k), k, a);
                if (typeof r !== "number") {
                    acc = r;
                    isSum = false;
                    k--;
                    break;
                }
                sum = r;
            }
        }
        if (isSum) acc = sum;
    } else if (isDoubleArray(a)) {
        for (; k >= 0 && isDoubleArray(a) && k < a.length; k--) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x) acc = $call<unknown>(f, undefined, acc, x, k, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) acc = $call<unknown>(f, undefined, acc, $getContiguousIndex<T>(a, k), k, a);
        }
    }
    if (k >= 0) acc = restOfReduceRight(a, f, acc, k);
    return acc as T;
}

function restOfFlatMap<T, U>(a: T[], f: unknown, thisArg: unknown, out: U[], to: number, k: number, n: number): number {
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (!has) continue;
        const y = $callNoInline<unknown>(f, thisArg, $getIndex<T>(a, k), k, a);
        if (!isArray(y)) {
            out[to] = y as U;
            to = (to + 1) >>> 0;
            continue;
        }
        const length = toLength((y as any).length);
        for (let j = 0; j < length; j++) {
            const hasPart: boolean = $hasIndex(y, j);
            if (hasPart) {
                out[to] = $getIndex<U>(y, j);
                to = (to + 1) >>> 0;
            }
        }
    }
    return to;
}

export function Array$flatMap<T, U>(a: T[], f: unknown, thisArg: unknown): U[] {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.flatMap callback must be a function");
    const out: U[] = $newContiguousArray<U>(!isDoubleArray(a) && !isContiguousArray(a) ? 0 : n <= 100000 ? n * 2 : n);
    const m = a.length;
    let k = 0;
    let to = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) continue;
            const y = $call<unknown>(f, thisArg, x, k, a);
            const isOriginal: boolean = $isOriginalArray(y);
            let count = 1;
            if (isOriginal) count = (y as U[]).length;
            if (to + count > out.length) $growNewArray(out, to + count);
            if ((isOriginal || !isArray(y)) && isContiguousArray(out) && to + count <= out.length) {
                if (!isOriginal) {
                    $putContiguousIndex(out, to, y);
                    to = (to + 1) >>> 0;
                    continue;
                }
                const part = y as U[];
                if (isContiguousArray(part)) {
                    for (let j = 0; j < count; j++) {
                        const hasPart: boolean = $hasContiguousIndex(part, j);
                        if (!hasPart) continue;
                        $putContiguousIndex(out, to, $getContiguousIndex<U>(part, j));
                        to = (to + 1) >>> 0;
                    }
                    continue;
                }
                if (isDoubleArray(part)) {
                    for (let j = 0; j < count; j++) {
                        const d: number = $getDoubleIndex(part, j);
                        if (d !== d) continue;
                        $putContiguousIndex(out, to, d);
                        to = (to + 1) >>> 0;
                    }
                    continue;
                }
            }
            if (!isArray(y)) {
                out[to] = y as U;
                to = (to + 1) >>> 0;
                continue;
            }
            const length = toLength((y as any).length);
            for (let j = 0; j < length; j++) {
                const hasPart: boolean = $hasIndex(y, j);
                if (hasPart) {
                    out[to] = $getIndex<U>(y, j);
                    to = (to + 1) >>> 0;
                }
            }
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) continue;
            const y = $call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k, a);
            const isOriginal: boolean = $isOriginalArray(y);
            let count = 1;
            if (isOriginal) count = (y as U[]).length;
            if (to + count > out.length) $growNewArray(out, to + count);
            if ((isOriginal || !isArray(y)) && isContiguousArray(out) && to + count <= out.length) {
                if (!isOriginal) {
                    $putContiguousIndex(out, to, y);
                    to = (to + 1) >>> 0;
                    continue;
                }
                const part = y as U[];
                if (isContiguousArray(part)) {
                    for (let j = 0; j < count; j++) {
                        const hasPart: boolean = $hasContiguousIndex(part, j);
                        if (!hasPart) continue;
                        $putContiguousIndex(out, to, $getContiguousIndex<U>(part, j));
                        to = (to + 1) >>> 0;
                    }
                    continue;
                }
                if (isDoubleArray(part)) {
                    for (let j = 0; j < count; j++) {
                        const d: number = $getDoubleIndex(part, j);
                        if (d !== d) continue;
                        $putContiguousIndex(out, to, d);
                        to = (to + 1) >>> 0;
                    }
                    continue;
                }
            }
            if (!isArray(y)) {
                out[to] = y as U;
                to = (to + 1) >>> 0;
                continue;
            }
            const length = toLength((y as any).length);
            for (let j = 0; j < length; j++) {
                const hasPart: boolean = $hasIndex(y, j);
                if (hasPart) {
                    out[to] = $getIndex<U>(y, j);
                    to = (to + 1) >>> 0;
                }
            }
        }
    }
    if (k < n) to = restOfFlatMap(a, f, thisArg, out, to, k, n) >>> 0;
    return $truncateNewArray<U>(out, to);
}

// The elements are read, then sorted where nobody sees them, then stored: a comparator that looks at the array finds it as it was.
export function Array$sort<T>(a: T[], f: unknown): T[] {
    if (!isCallable(f)) return (a as any).sort(f, undefined);
    const n = a.length;
    if (n < 2) return a;
    let undefinedCount = 0;
    if (isDoubleArray(a)) {
        let from: number[] = $newDoubleArray(n);
        let count = 0;
        for (let k = 0; k < n; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) continue;
            $putDoubleIndex(from, count, x);
            count = (count + 1) | 0;
        }
        let i = 1;
        for (; i < count; i = (i + 1) | 0) {
            const x: number = $getDoubleIndex(from, i);
            const y: number = $getDoubleIndex(from, i - 1);
            if (!saysLess($call<unknown>(f, undefined, x, y))) break;
        }
        const isWholeInOrder = i >= count;
        if (i === 1) i = 2;
        else {
            for (let first = 0, last = (i - 1) | 0; first < last; first = (first + 1) | 0, last = (last - 1) | 0) {
                const x: number = $getDoubleIndex(from, first);
                $putDoubleIndex(from, first, $getDoubleIndex(from, last));
                $putDoubleIndex(from, last, x);
            }
        }
        for (let base = i & -8; base < count; base = (base + 8) | 0, i = (i + 1) | 0) {
            const end = base + 8 < count ? (base + 8) | 0 : count;
            for (; i < end; i = (i + 1) | 0) {
                const x: number = $getDoubleIndex(from, i);
                let j = (i - 1) | 0;
                for (; j >= base; j = (j - 1) | 0) {
                    const y: number = $getDoubleIndex(from, j);
                    if (!saysLess($call<unknown>(f, undefined, x, y))) break;
                    $putDoubleIndex(from, j + 1, y);
                }
                $putDoubleIndex(from, j + 1, x);
            }
        }
        if (count > 8 && !isWholeInOrder) {
            let to: number[] = $newDoubleArray(n);
            for (let width = 8; width < count; width = (width * 2) | 0) {
                for (let low = 0; low < count; low = (low + width * 2) | 0) {
                    const middle = low + width < count ? (low + width) | 0 : count;
                    const high = low + width * 2 < count ? (low + width * 2) | 0 : count;
                    let left = low;
                    let right = middle;
                    let t = low;
                    let isOrdered = middle >= high;
                    if (!isOrdered) {
                        const last: number = $getDoubleIndex(from, middle - 1);
                        const next: number = $getDoubleIndex(from, middle);
                        isOrdered = !saysLess($call<unknown>(f, undefined, next, last));
                    }
                    if (isOrdered) {
                        for (; left < high; left = (left + 1) | 0) $putDoubleIndex(to, left, $getDoubleIndex(from, left));
                        continue;
                    }
                    while (left < middle && right < high) {
                        const x: number = $getDoubleIndex(from, left);
                        const y: number = $getDoubleIndex(from, right);
                        if (saysLess($call<unknown>(f, undefined, y, x))) {
                            $putDoubleIndex(to, t, y);
                            right = (right + 1) | 0;
                        } else {
                            $putDoubleIndex(to, t, x);
                            left = (left + 1) | 0;
                        }
                        t = (t + 1) | 0;
                    }
                    for (; left < middle; left = (left + 1) | 0, t = (t + 1) | 0) $putDoubleIndex(to, t, $getDoubleIndex(from, left));
                    for (; right < high; right = (right + 1) | 0, t = (t + 1) | 0) $putDoubleIndex(to, t, $getDoubleIndex(from, right));
                }
                const swapped = from;
                from = to;
                to = swapped;
            }
        }
        let k = 0;
        if (count > 0) {
            const first: number = $getDoubleIndex(from, 0);
            const isFirstStored: boolean = $tryPutIndex(a, 0, first);
            if (!isFirstStored) a[0] = first as unknown as T;
            k = 1;
            if (isDoubleArray(a) && count <= a.length) {
                for (; k < count; k++) $putDoubleIndex(a, k, $getDoubleIndex(from, k));
            }
        }
        for (; k < count; k++) {
            const x: number = $getDoubleIndex(from, k);
            const isStored: boolean = $tryPutIndex(a, k, x);
            if (!isStored) a[k] = x as unknown as T;
        }
        for (; k < n; k++) delete a[k];
        return a;
    }
    if (!isContiguousArray(a)) return (a as any).sort(f, undefined);
        let from: T[] = $newContiguousArray<T>(n);
        let count = 0;
        for (let k = 0; k < n; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) continue;
            const x = $getContiguousIndex<T>(a, k);
            if (x === undefined) {
                undefinedCount = (undefinedCount + 1) | 0;
                continue;
            }
            $putContiguousIndex(from, count, x);
            count = (count + 1) | 0;
        }
        let i = 1;
        for (; i < count; i = (i + 1) | 0) {
            const x: T = $getContiguousIndex<T>(from, i);
            const y: T = $getContiguousIndex<T>(from, i - 1);
            if (!saysLess($call<unknown>(f, undefined, x, y))) break;
        }
        const isWholeInOrder = i >= count;
        if (i === 1) i = 2;
        else {
            for (let first = 0, last = (i - 1) | 0; first < last; first = (first + 1) | 0, last = (last - 1) | 0) {
                const x: T = $getContiguousIndex<T>(from, first);
                $putContiguousIndex(from, first, $getContiguousIndex<T>(from, last));
                $putContiguousIndex(from, last, x);
            }
        }
        for (let base = i & -8; base < count; base = (base + 8) | 0, i = (i + 1) | 0) {
            const end = base + 8 < count ? (base + 8) | 0 : count;
            for (; i < end; i = (i + 1) | 0) {
                const x: T = $getContiguousIndex<T>(from, i);
                let j = (i - 1) | 0;
                for (; j >= base; j = (j - 1) | 0) {
                    const y: T = $getContiguousIndex<T>(from, j);
                    if (!saysLess($call<unknown>(f, undefined, x, y))) break;
                    $putContiguousIndex(from, j + 1, y);
                }
                $putContiguousIndex(from, j + 1, x);
            }
        }
        if (count > 8 && !isWholeInOrder) {
            let to: T[] = $newContiguousArray<T>(n);
            for (let width = 8; width < count; width = (width * 2) | 0) {
                for (let low = 0; low < count; low = (low + width * 2) | 0) {
                    const middle = low + width < count ? (low + width) | 0 : count;
                    const high = low + width * 2 < count ? (low + width * 2) | 0 : count;
                    let left = low;
                    let right = middle;
                    let t = low;
                    let isOrdered = middle >= high;
                    if (!isOrdered) {
                        const last: T = $getContiguousIndex<T>(from, middle - 1);
                        const next: T = $getContiguousIndex<T>(from, middle);
                        isOrdered = !saysLess($call<unknown>(f, undefined, next, last));
                    }
                    if (isOrdered) {
                        for (; left < high; left = (left + 1) | 0) $putContiguousIndex(to, left, $getContiguousIndex<T>(from, left));
                        continue;
                    }
                    while (left < middle && right < high) {
                        const x: T = $getContiguousIndex<T>(from, left);
                        const y: T = $getContiguousIndex<T>(from, right);
                        if (saysLess($call<unknown>(f, undefined, y, x))) {
                            $putContiguousIndex(to, t, y);
                            right = (right + 1) | 0;
                        } else {
                            $putContiguousIndex(to, t, x);
                            left = (left + 1) | 0;
                        }
                        t = (t + 1) | 0;
                    }
                    for (; left < middle; left = (left + 1) | 0, t = (t + 1) | 0) $putContiguousIndex(to, t, $getContiguousIndex<T>(from, left));
                    for (; right < high; right = (right + 1) | 0, t = (t + 1) | 0) $putContiguousIndex(to, t, $getContiguousIndex<T>(from, right));
                }
                const swapped = from;
                from = to;
                to = swapped;
            }
        }
        let k = 0;
        if (count > 0) {
            const first = $getContiguousIndex<T>(from, 0);
            const isFirstStored: boolean = $tryPutIndex(a, 0, first);
            if (!isFirstStored) a[0] = first;
            k = 1;
            if (isContiguousArray(a) && count <= a.length) {
                for (; k < count; k++) $putContiguousIndex(a, k, $getContiguousIndex<T>(from, k));
            }
        }
        for (; k < count; k++) {
            const x = $getContiguousIndex<T>(from, k);
            const isStored: boolean = $tryPutIndex(a, k, x);
            if (!isStored) a[k] = x;
        }
        for (; undefinedCount > 0; undefinedCount = (undefinedCount - 1) | 0, k++) a[k] = undefined as unknown as T;
        for (; k < n; k++) delete a[k];
        return a;
}

export function Array$toSorted<T>(a: T[], f: unknown): T[] {
    if (!isCallable(f)) return (a as any).toSorted(f, undefined);
    const n = a.length;
    let undefinedCount = 0;
    if (isDoubleArray(a)) {
        let from: number[] = $newDoubleArray(n);
        let count = 0;
        for (let k = 0; k < n; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) continue;
            $putDoubleIndex(from, count, x);
            count = (count + 1) | 0;
        }
        if (count !== n) return (a as any).toSorted(f, undefined);
        let i = 1;
        for (; i < count; i = (i + 1) | 0) {
            const x: number = $getDoubleIndex(from, i);
            const y: number = $getDoubleIndex(from, i - 1);
            if (!saysLess($call<unknown>(f, undefined, x, y))) break;
        }
        const isWholeInOrder = i >= count;
        if (i === 1) i = 2;
        else {
            for (let first = 0, last = (i - 1) | 0; first < last; first = (first + 1) | 0, last = (last - 1) | 0) {
                const x: number = $getDoubleIndex(from, first);
                $putDoubleIndex(from, first, $getDoubleIndex(from, last));
                $putDoubleIndex(from, last, x);
            }
        }
        for (let base = i & -8; base < count; base = (base + 8) | 0, i = (i + 1) | 0) {
            const end = base + 8 < count ? (base + 8) | 0 : count;
            for (; i < end; i = (i + 1) | 0) {
                const x: number = $getDoubleIndex(from, i);
                let j = (i - 1) | 0;
                for (; j >= base; j = (j - 1) | 0) {
                    const y: number = $getDoubleIndex(from, j);
                    if (!saysLess($call<unknown>(f, undefined, x, y))) break;
                    $putDoubleIndex(from, j + 1, y);
                }
                $putDoubleIndex(from, j + 1, x);
            }
        }
        if (count > 8 && !isWholeInOrder) {
            let to: number[] = $newDoubleArray(n);
            for (let width = 8; width < count; width = (width * 2) | 0) {
                for (let low = 0; low < count; low = (low + width * 2) | 0) {
                    const middle = low + width < count ? (low + width) | 0 : count;
                    const high = low + width * 2 < count ? (low + width * 2) | 0 : count;
                    let left = low;
                    let right = middle;
                    let t = low;
                    let isOrdered = middle >= high;
                    if (!isOrdered) {
                        const last: number = $getDoubleIndex(from, middle - 1);
                        const next: number = $getDoubleIndex(from, middle);
                        isOrdered = !saysLess($call<unknown>(f, undefined, next, last));
                    }
                    if (isOrdered) {
                        for (; left < high; left = (left + 1) | 0) $putDoubleIndex(to, left, $getDoubleIndex(from, left));
                        continue;
                    }
                    while (left < middle && right < high) {
                        const x: number = $getDoubleIndex(from, left);
                        const y: number = $getDoubleIndex(from, right);
                        if (saysLess($call<unknown>(f, undefined, y, x))) {
                            $putDoubleIndex(to, t, y);
                            right = (right + 1) | 0;
                        } else {
                            $putDoubleIndex(to, t, x);
                            left = (left + 1) | 0;
                        }
                        t = (t + 1) | 0;
                    }
                    for (; left < middle; left = (left + 1) | 0, t = (t + 1) | 0) $putDoubleIndex(to, t, $getDoubleIndex(from, left));
                    for (; right < high; right = (right + 1) | 0, t = (t + 1) | 0) $putDoubleIndex(to, t, $getDoubleIndex(from, right));
                }
                const swapped = from;
                from = to;
                to = swapped;
            }
        }
        return $truncateNewArray<T>(from as unknown as T[], n);
    }
    if (!isContiguousArray(a)) return (a as any).toSorted(f, undefined);
        let from: T[] = $newContiguousArray<T>(n);
        let count = 0;
        for (let k = 0; k < n; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) continue;
            const x = $getContiguousIndex<T>(a, k);
            if (x === undefined) {
                undefinedCount = (undefinedCount + 1) | 0;
                continue;
            }
            $putContiguousIndex(from, count, x);
            count = (count + 1) | 0;
        }
        let i = 1;
        for (; i < count; i = (i + 1) | 0) {
            const x: T = $getContiguousIndex<T>(from, i);
            const y: T = $getContiguousIndex<T>(from, i - 1);
            if (!saysLess($call<unknown>(f, undefined, x, y))) break;
        }
        const isWholeInOrder = i >= count;
        if (i === 1) i = 2;
        else {
            for (let first = 0, last = (i - 1) | 0; first < last; first = (first + 1) | 0, last = (last - 1) | 0) {
                const x: T = $getContiguousIndex<T>(from, first);
                $putContiguousIndex(from, first, $getContiguousIndex<T>(from, last));
                $putContiguousIndex(from, last, x);
            }
        }
        for (let base = i & -8; base < count; base = (base + 8) | 0, i = (i + 1) | 0) {
            const end = base + 8 < count ? (base + 8) | 0 : count;
            for (; i < end; i = (i + 1) | 0) {
                const x: T = $getContiguousIndex<T>(from, i);
                let j = (i - 1) | 0;
                for (; j >= base; j = (j - 1) | 0) {
                    const y: T = $getContiguousIndex<T>(from, j);
                    if (!saysLess($call<unknown>(f, undefined, x, y))) break;
                    $putContiguousIndex(from, j + 1, y);
                }
                $putContiguousIndex(from, j + 1, x);
            }
        }
        if (count > 8 && !isWholeInOrder) {
            let to: T[] = $newContiguousArray<T>(n);
            for (let width = 8; width < count; width = (width * 2) | 0) {
                for (let low = 0; low < count; low = (low + width * 2) | 0) {
                    const middle = low + width < count ? (low + width) | 0 : count;
                    const high = low + width * 2 < count ? (low + width * 2) | 0 : count;
                    let left = low;
                    let right = middle;
                    let t = low;
                    let isOrdered = middle >= high;
                    if (!isOrdered) {
                        const last: T = $getContiguousIndex<T>(from, middle - 1);
                        const next: T = $getContiguousIndex<T>(from, middle);
                        isOrdered = !saysLess($call<unknown>(f, undefined, next, last));
                    }
                    if (isOrdered) {
                        for (; left < high; left = (left + 1) | 0) $putContiguousIndex(to, left, $getContiguousIndex<T>(from, left));
                        continue;
                    }
                    while (left < middle && right < high) {
                        const x: T = $getContiguousIndex<T>(from, left);
                        const y: T = $getContiguousIndex<T>(from, right);
                        if (saysLess($call<unknown>(f, undefined, y, x))) {
                            $putContiguousIndex(to, t, y);
                            right = (right + 1) | 0;
                        } else {
                            $putContiguousIndex(to, t, x);
                            left = (left + 1) | 0;
                        }
                        t = (t + 1) | 0;
                    }
                    for (; left < middle; left = (left + 1) | 0, t = (t + 1) | 0) $putContiguousIndex(to, t, $getContiguousIndex<T>(from, left));
                    for (; right < high; right = (right + 1) | 0, t = (t + 1) | 0) $putContiguousIndex(to, t, $getContiguousIndex<T>(from, right));
                }
                const swapped = from;
                from = to;
                to = swapped;
            }
        }
        for (let k = count; k < n; k++) $putContiguousIndex(from, k, undefined);
        return $truncateNewArray<T>(from, n);
}

// The iteration of an array with its original structure cannot be observed: it asks for the length and then for the element, every time.
export function Array$from<T, U>(items: unknown, f: unknown, thisArg: unknown): U[] {
    if (f !== undefined && !isCallable(f)) throw new TypeError("Array.from requires that the second argument, when provided, be a function");
    const isOriginal: boolean = $isOriginalArray(items);
    const isLike: boolean = isOriginal ? false : $isPlainArrayLike(items);
    if (f !== undefined && isLike) {
        const out: U[] = $newArrayWithSpecies<U>(toLength((items as any).length), undefined);
        const n = out.length;
        let k = 0;
        if (isDoubleArray(out) || isContiguousArray(out)) {
            for (; k < n; k++) {
                const isStillLike: boolean = $isPlainArrayLike(items);
                if (!isStillLike) break;
                const y = $call<U>(f, thisArg, undefined, k);
                const isStored: boolean = $tryPutByValDirect(out, k, y);
                if (!isStored) {
                    out[k++] = y;
                    break;
                }
            }
        }
        for (; k < n; k++) out[k] = $callNoInline<U>(f, thisArg, $getIndex<T>(items, k), k);
        return $truncateNewArray<U>(out, n);
    }
    if (f === undefined || !isOriginal) return (Array as any).from(items, f, thisArg, undefined);
    const a = items as T[];
    const n = a.length;
    const out: U[] = $newArrayWithCapacity<U>(n, a);
    const m = a.length;
    let k = 0;
    if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) break;
            const y = $call<U>(f, thisArg, x, k);
            const isStored: boolean = $tryPutByValDirect(out, k, y);
            if (!isStored) {
                out[k++] = y;
                break;
            }
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) break;
            const y = $call<U>(f, thisArg, $getContiguousIndex<T>(a, k), k);
            const isStored: boolean = $tryPutByValDirect(out, k, y);
            if (!isStored) {
                out[k++] = y;
                break;
            }
        }
    }
    for (; k < a.length; k++) out[k] = $callNoInline<U>(f, thisArg, $getIndex<T>(a, k), k);
    return $truncateNewArray<U>(out, k);
}
