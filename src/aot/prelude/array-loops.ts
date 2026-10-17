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
declare function $trySortByKey<T>(a: unknown[], name: unknown, flags: number): T[] | null;

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

function forEachFrom<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): void {
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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x === x) $call<unknown>(f, thisArg, x, k & 0x7fffffff, a);
            }
        } else if (isContiguousArray(a)) {
            for (; k < m && isContiguousArray(a) && k < a.length; k++) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (has) $call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
            }
        }
    }
    if (k < n) forEachFrom(a, f, thisArg, k, n);
}

function mapFrom<T, U>(a: T[], f: unknown, thisArg: unknown, out: U[], k: number, n: number): void {
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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) continue;
                const y = $call<U>(f, thisArg, x, k & 0x7fffffff, a);
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
                const y = $call<U>(f, thisArg, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
                const isStored: boolean = $tryPutByValDirect(out, k, y);
                if (!isStored) {
                    out[k++] = y;
                    break;
                }
            }
        }
    }
    if (k < n) mapFrom(a, f, thisArg, out, k, n);
    return $truncateNewArray<U>(out, n);
}

export function Array$mapJoin<T>(items: unknown, f: unknown, separator: string): string {
    const isOriginal: boolean = $isOriginalArray(items);
    if (!isOriginal) return (items as any).map(f).join(separator);
    const a = items as T[];
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.map callback must be a function");
    const m = a.length;
    const separatorLength = separator.length;
    let remaining = 0x7fffffff;
    let joined = "";
    let hasResult = false;
    let result: unknown = undefined;
    let k = 0;
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                result = "";
                if (x === x) result = $call<unknown>(f, undefined, x, k & 0x7fffffff, a);
                hasResult = x === x;
                if (typeof result !== "string") break;
                remaining = (remaining - result.length) | 0;
                if (remaining < 0) break;
                if (k) {
                    remaining = (remaining - separatorLength) | 0;
                    if (remaining < 0) break;
                    joined = `${joined}${separator}${result}`;
                } else joined = result;
                hasResult = false;
            }
        } else if (isContiguousArray(a)) {
            for (; k < m && isContiguousArray(a) && k < a.length; k++) {
                const has: boolean = $hasContiguousIndex(a, k);
                result = "";
                if (has) result = $call<unknown>(f, undefined, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
                hasResult = has;
                if (typeof result !== "string") break;
                remaining = (remaining - result.length) | 0;
                if (remaining < 0) break;
                if (k) {
                    remaining = (remaining - separatorLength) | 0;
                    if (remaining < 0) break;
                    joined = `${joined}${separator}${result}`;
                } else joined = result;
                hasResult = false;
            }
        }
    }
    if (k === n) return joined;
    const start = k;
    const rest: unknown[] = $newArrayWithSpecies<unknown>(n - k, undefined);
    if (hasResult) rest[k++ - start] = result;
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (has) rest[k - start] = $callNoInline<unknown>(f, undefined, $getIndex<T>(a, k), k, a);
    }
    for (k = start; k < n; k++) {
        const element = rest[k - start];
        const piece = element === undefined || element === null ? "" : `${element}`;
        joined = k ? `${joined}${separator}${piece}` : piece;
    }
    return joined;
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
    if (k < n) mapFrom(a, f, thisArg, out, k, n);
    return $truncateNewArray<unknown>(out, n);
}

function filterFrom<T>(a: T[], f: unknown, thisArg: unknown, out: T[], to: number, k: number, n: number): number {
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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) continue;
                if (!$call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) continue;
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
                if (!$call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) continue;
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
    }
    if (k < n) to = filterFrom(a, f, thisArg, out, to, k, n) >>> 0;
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
    if (k < n) to = filterFrom(a, f, thisArg, out, to, k, n) >>> 0;
    return $truncateNewArray<T>(out, to);
}

function someFrom<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): boolean {
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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x === x && $call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) return true;
            }
        } else if (isContiguousArray(a)) {
            for (; k < m && isContiguousArray(a) && k < a.length; k++) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (has && $call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a)) return true;
            }
        }
    }
    return k < n && someFrom(a, f, thisArg, k, n);
}

function everyFrom<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): boolean {
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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x === x && !$call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) return false;
            }
        } else if (isContiguousArray(a)) {
            for (; k < m && isContiguousArray(a) && k < a.length; k++) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (has && !$call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a)) return false;
            }
        }
    }
    return k >= n || everyFrom(a, f, thisArg, k, n);
}

function findFrom<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): T | undefined {
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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) break;
                if ($call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) return x as unknown as T;
            }
        } else if (isContiguousArray(a)) {
            for (; k < m && isContiguousArray(a) && k < a.length; k++) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (!has) break;
                const x = $getContiguousIndex<T>(a, k);
                if ($call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) return x;
            }
        }
    }
    return k < n ? findFrom(a, f, thisArg, k, n) : undefined;
}

function findLastFrom<T>(a: T[], f: unknown, thisArg: unknown, k: number): T | undefined {
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
            if ($call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) return x as unknown as T;
        }
    } else if (isContiguousArray(a)) {
        for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) break;
            const x = $getContiguousIndex<T>(a, k);
            if ($call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) return x;
        }
    }
    return k >= 0 ? findLastFrom(a, f, thisArg, k) : undefined;
}

function findIndexFrom<T>(a: T[], f: unknown, thisArg: unknown, k: number, n: number): number {
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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) break;
                if ($call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) return k;
            }
        } else if (isContiguousArray(a)) {
            for (; k < m && isContiguousArray(a) && k < a.length; k++) {
                const has: boolean = $hasContiguousIndex(a, k);
                if (!has) break;
                if ($call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a)) return k;
            }
        }
    }
    return k < n ? findIndexFrom(a, f, thisArg, k, n) : -1;
}

function findLastIndexFrom<T>(a: T[], f: unknown, thisArg: unknown, k: number): number {
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
            if ($call<unknown>(f, thisArg, x, k & 0x7fffffff, a)) return k;
        }
    } else if (isContiguousArray(a)) {
        for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (!has) break;
            if ($call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a)) return k;
        }
    }
    return k >= 0 ? findLastIndexFrom(a, f, thisArg, k) : -1;
}

function reduceFrom<T>(a: T[], f: unknown, acc: unknown, k: number, n: number): unknown {
    for (; k < n; k++) {
        const has: boolean = $hasIndex(a, k);
        if (has) acc = $callNoInline<unknown>(f, undefined, acc, $getIndex<T>(a, k), k, a);
    }
    return acc;
}

export function Array$reduce<T, A>(a: T[], f: unknown, initial: A): A {
    const n = a.length;
    if (!isCallable(f)) throw new TypeError("Array.prototype.reduce callback must be a function");
    let k = 0;
    let acc: unknown = initial;
    const m = a.length;
    if (typeof acc === "number") {
        let sum: number = acc;
        let isSum = true;
        if (m) {
            if (isDoubleArray(a)) {
                for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                    const x: number = $getDoubleIndex(a, k);
                    if (x !== x) continue;
                    const r = $call<unknown>(f, undefined, sum, x, k & 0x7fffffff, a);
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
                    const r = $call<unknown>(f, undefined, sum, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
                    if (typeof r !== "number") {
                        acc = r;
                        isSum = false;
                        k++;
                        break;
                    }
                    sum = r;
                }
            }
        }
        if (isSum) acc = sum;
    } else if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x) acc = $call<unknown>(f, undefined, acc, x, k & 0x7fffffff, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) acc = $call<unknown>(f, undefined, acc, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
        }
    }
    if (k < n) acc = reduceFrom(a, f, acc, k, n);
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
        if (m) {
            if (isDoubleArray(a)) {
                for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                    const x: number = $getDoubleIndex(a, k);
                    if (x !== x) continue;
                    const r = $call<unknown>(f, undefined, sum, x, k & 0x7fffffff, a);
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
                    const r = $call<unknown>(f, undefined, sum, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
                    if (typeof r !== "number") {
                        acc = r;
                        isSum = false;
                        k++;
                        break;
                    }
                    sum = r;
                }
            }
        }
        if (isSum) acc = sum;
    } else if (isDoubleArray(a)) {
        for (; k < m && isDoubleArray(a) && k < a.length; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x === x) acc = $call<unknown>(f, undefined, acc, x, k & 0x7fffffff, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k < m && isContiguousArray(a) && k < a.length; k++) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) acc = $call<unknown>(f, undefined, acc, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
        }
    }
    if (k < n) acc = reduceFrom(a, f, acc, k, n);
    return acc as T;
}

function reduceRightFrom<T>(a: T[], f: unknown, acc: unknown, k: number): unknown {
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
                const r = $call<unknown>(f, undefined, sum, x, k & 0x7fffffff, a);
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
                const r = $call<unknown>(f, undefined, sum, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
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
            if (x === x) acc = $call<unknown>(f, undefined, acc, x, k & 0x7fffffff, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) acc = $call<unknown>(f, undefined, acc, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
        }
    }
    if (k >= 0) acc = reduceRightFrom(a, f, acc, k);
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
                const r = $call<unknown>(f, undefined, sum, x, k & 0x7fffffff, a);
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
                const r = $call<unknown>(f, undefined, sum, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
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
            if (x === x) acc = $call<unknown>(f, undefined, acc, x, k & 0x7fffffff, a);
        }
    } else if (isContiguousArray(a)) {
        for (; k >= 0 && isContiguousArray(a) && k < a.length; k--) {
            const has: boolean = $hasContiguousIndex(a, k);
            if (has) acc = $call<unknown>(f, undefined, acc, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
        }
    }
    if (k >= 0) acc = reduceRightFrom(a, f, acc, k);
    return acc as T;
}

function flatMapFrom<T, U>(a: T[], f: unknown, thisArg: unknown, out: U[], to: number, k: number, n: number): number {
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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) continue;
                const y = $call<unknown>(f, thisArg, x, k & 0x7fffffff, a);
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
                const y = $call<unknown>(f, thisArg, $getContiguousIndex<T>(a, k), k & 0x7fffffff, a);
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
    }
    if (k < n) to = flatMapFrom(a, f, thisArg, out, to, k, n) >>> 0;
    return $truncateNewArray<U>(out, to);
}

function gallop(key: unknown, from: unknown[], base: number, length: number, hint: number, f: unknown, isAfterEqual: boolean): number {
    let lastOffset = 0;
    let offset = 1;
    const atHint: unknown = $getIndex<unknown>(from, base + hint);
    if (isAfterEqual ? !saysLess($callNoInline<unknown>(f, undefined, key, atHint)) : saysLess($callNoInline<unknown>(f, undefined, atHint, key))) {
        const maxOffset = (length - hint) | 0;
        while (offset < maxOffset) {
            const x: unknown = $getIndex<unknown>(from, base + hint + offset);
            if (isAfterEqual ? saysLess($callNoInline<unknown>(f, undefined, key, x)) : !saysLess($callNoInline<unknown>(f, undefined, x, key))) break;
            lastOffset = offset;
            offset = (offset * 2 + 1) | 0;
            if (offset > maxOffset) offset = maxOffset;
        }
        lastOffset = (lastOffset + hint) | 0;
        offset = (offset + hint) | 0;
    } else {
        const maxOffset = (hint + 1) | 0;
        while (offset < maxOffset) {
            const x: unknown = $getIndex<unknown>(from, base + hint - offset);
            if (isAfterEqual ? !saysLess($callNoInline<unknown>(f, undefined, key, x)) : saysLess($callNoInline<unknown>(f, undefined, x, key))) break;
            lastOffset = offset;
            offset = (offset * 2 + 1) | 0;
            if (offset > maxOffset) offset = maxOffset;
        }
        const previous = lastOffset;
        lastOffset = (hint - offset) | 0;
        offset = (hint - previous) | 0;
    }
    lastOffset = (lastOffset + 1) | 0;
    while (lastOffset < offset) {
        const middle = (lastOffset + ((offset - lastOffset) >> 1)) | 0;
        const x: unknown = $getIndex<unknown>(from, base + middle);
        if (isAfterEqual ? !saysLess($callNoInline<unknown>(f, undefined, key, x)) : saysLess($callNoInline<unknown>(f, undefined, x, key))) lastOffset = (middle + 1) | 0;
        else offset = middle;
    }
    return offset;
}

function sortValues<T>(from: T[], count: number, f: unknown): void {
    let to: T[] = from;
    let depth = 0;
    let minGallop = 7;
    let previousBegin = 0;
    let previousEnd = 0;
    for (let begin = 0; ; ) {
        let end = begin;
        let power = -1;
        if (begin < count) {
            if (count >= 8 && end + 1 < count) {
                const first: T = $getContiguousIndex<T>(from, end);
                const second: T = $getContiguousIndex<T>(from, end + 1);
                end = (end + 1) | 0;
                if (saysLess($call<unknown>(f, undefined, second, first))) {
                    for (; end + 1 < count; end = (end + 1) | 0) {
                        const x: T = $getContiguousIndex<T>(from, end + 1);
                        const y: T = $getContiguousIndex<T>(from, end);
                        if (!saysLess($call<unknown>(f, undefined, x, y))) break;
                    }
                    for (let low = begin, high = end; low < high; low = (low + 1) | 0, high = (high - 1) | 0) {
                        const x: T = $getContiguousIndex<T>(from, low);
                        $putContiguousIndex(from, low, $getContiguousIndex<T>(from, high));
                        $putContiguousIndex(from, high, x);
                    }
                } else {
                    for (; end + 1 < count; end = (end + 1) | 0) {
                        const x: T = $getContiguousIndex<T>(from, end + 1);
                        const y: T = $getContiguousIndex<T>(from, end);
                        if (saysLess($call<unknown>(f, undefined, x, y))) break;
                    }
                }
            }
            if (end - begin < 8) {
                const limit = count - begin < 64 ? count : (begin + 64) | 0;
                for (let i = (end + 1) | 0; i < limit; i = (i + 1) | 0) {
                    const x: T = $getContiguousIndex<T>(from, i);
                    let left = begin;
                    let right = i;
                    while (left < right) {
                        const middle = (left + ((right - left) >> 1)) | 0;
                        const y: T = $getContiguousIndex<T>(from, middle);
                        if (saysLess($call<unknown>(f, undefined, x, y))) right = middle;
                        else left = (middle + 1) | 0;
                    }
                    let j = i;
                    for (; j - 1 > left; j = (j - 2) | 0) {
                        const above: T = $getContiguousIndex<T>(from, j - 1);
                        const below: T = $getContiguousIndex<T>(from, j - 2);
                        $putContiguousIndex(from, j, above);
                        $putContiguousIndex(from, j - 1, below);
                    }
                    if (j > left) $putContiguousIndex(from, j, $getContiguousIndex<T>(from, j - 1));
                    $putContiguousIndex(from, left, x);
                }
                end = (limit - 1) | 0;
            }
            for (; end + 1 < count; end = (end + 1) | 0) {
                const x: T = $getContiguousIndex<T>(from, end + 1);
                const y: T = $getContiguousIndex<T>(from, end);
                if (saysLess($call<unknown>(f, undefined, x, y))) break;
            }
            if (begin > 0) {
                let a = previousBegin + begin;
                let b = begin + end + 1;
                power = 0;
                while (a >= count === b >= count) {
                    if (a >= count) {
                        a -= count;
                        b -= count;
                    }
                    a *= 2;
                    b *= 2;
                    power = (power + 1) | 0;
                }
            }
        }
        while (depth > 0) {
            const powerBelow: number = $getContiguousIndex<number>(to, count + depth * 2 - 1);
            if (powerBelow <= power) break;
            depth = (depth - 1) | 0;
            const low: number = $getContiguousIndex<number>(to, count + depth * 2) | 0;
            const middle = previousBegin;
            previousBegin = low;
            let left = (low + gallop($getContiguousIndex<T>(from, middle), from, low, middle - low, 0, f, true)) | 0;
            if (left >= middle) continue;
            const high = (middle + gallop($getContiguousIndex<T>(from, middle - 1), from, middle, previousEnd + 1 - middle, previousEnd - middle, f, false)) | 0;
            if (high <= middle) continue;
            const first = left;
            let right = middle;
            let t = left;
            merging: for (;;) {
                let leftWins = 0;
                let rightWins = 0;
                while (leftWins < minGallop && rightWins < minGallop) {
                    if (right >= high || left >= middle) break merging;
                    const x: T = $getContiguousIndex<T>(from, left);
                    const y: T = $getContiguousIndex<T>(from, right);
                    if (saysLess($call<unknown>(f, undefined, y, x))) {
                        $putContiguousIndex(to, t, y);
                        right = (right + 1) | 0;
                        rightWins = (rightWins + 1) | 0;
                        leftWins = 0;
                    } else {
                        $putContiguousIndex(to, t, x);
                        left = (left + 1) | 0;
                        leftWins = (leftWins + 1) | 0;
                        rightWins = 0;
                    }
                    t = (t + 1) | 0;
                }
                minGallop = (minGallop + 1) | 0;
                do {
                    if (minGallop > 1) minGallop = (minGallop - 1) | 0;
                    if (left >= middle || right >= high) break merging;
                    leftWins = gallop($getContiguousIndex<T>(from, right), from, left, middle - left, 0, f, true);
                    for (let k = 0; k < leftWins; k = (k + 1) | 0, t = (t + 1) | 0, left = (left + 1) | 0) $putContiguousIndex(to, t, $getContiguousIndex<T>(from, left));
                    $putContiguousIndex(to, t, $getContiguousIndex<T>(from, right));
                    t = (t + 1) | 0;
                    right = (right + 1) | 0;
                    if (left >= middle || right >= high) break merging;
                    rightWins = gallop($getContiguousIndex<T>(from, left), from, right, high - right, 0, f, false);
                    for (let k = 0; k < rightWins; k = (k + 1) | 0, t = (t + 1) | 0, right = (right + 1) | 0) $putContiguousIndex(to, t, $getContiguousIndex<T>(from, right));
                    $putContiguousIndex(to, t, $getContiguousIndex<T>(from, left));
                    t = (t + 1) | 0;
                    left = (left + 1) | 0;
                    if (left >= middle || right >= high) break merging;
                } while (leftWins >= 7 || rightWins >= 7);
                minGallop = (minGallop + 1) | 0;
            }
            for (; left < middle; left = (left + 1) | 0, t = (t + 1) | 0) $putContiguousIndex(to, t, $getContiguousIndex<T>(from, left));
            for (; right < high; right = (right + 1) | 0, t = (t + 1) | 0) $putContiguousIndex(to, t, $getContiguousIndex<T>(from, right));
            for (let k = first; k < high; k = (k + 1) | 0) $putContiguousIndex(from, k, $getContiguousIndex<T>(to, k));
        }
        if (begin >= count) return;
        if (begin > 0) {
            if (to === from) to = $newContiguousArray<T>(count + 72);
            $putContiguousIndex(to, count + depth * 2, previousBegin);
            $putContiguousIndex(to, count + depth * 2 + 1, power);
            depth = (depth + 1) | 0;
        }
        previousBegin = begin;
        previousEnd = end;
        begin = (end + 1) | 0;
    }
}

function sortDoubles(from: number[], count: number, f: unknown): void {
    let to: number[] = from;
    let depth = 0;
    let minGallop = 7;
    let previousBegin = 0;
    let previousEnd = 0;
    for (let begin = 0; ; ) {
        let end = begin;
        let power = -1;
        if (begin < count) {
            if (count >= 8 && end + 1 < count) {
                const first: number = $getDoubleIndex(from, end);
                const second: number = $getDoubleIndex(from, end + 1);
                end = (end + 1) | 0;
                if (saysLess($call<unknown>(f, undefined, second, first))) {
                    for (; end + 1 < count; end = (end + 1) | 0) {
                        const x: number = $getDoubleIndex(from, end + 1);
                        const y: number = $getDoubleIndex(from, end);
                        if (!saysLess($call<unknown>(f, undefined, x, y))) break;
                    }
                    for (let low = begin, high = end; low < high; low = (low + 1) | 0, high = (high - 1) | 0) {
                        const x: number = $getDoubleIndex(from, low);
                        $putDoubleIndex(from, low, $getDoubleIndex(from, high));
                        $putDoubleIndex(from, high, x);
                    }
                } else {
                    for (; end + 1 < count; end = (end + 1) | 0) {
                        const x: number = $getDoubleIndex(from, end + 1);
                        const y: number = $getDoubleIndex(from, end);
                        if (saysLess($call<unknown>(f, undefined, x, y))) break;
                    }
                }
            }
            if (end - begin < 8) {
                const limit = count - begin < 64 ? count : (begin + 64) | 0;
                for (let i = (end + 1) | 0; i < limit; i = (i + 1) | 0) {
                    const x: number = $getDoubleIndex(from, i);
                    let left = begin;
                    let right = i;
                    while (left < right) {
                        const middle = (left + ((right - left) >> 1)) | 0;
                        const y: number = $getDoubleIndex(from, middle);
                        if (saysLess($call<unknown>(f, undefined, x, y))) right = middle;
                        else left = (middle + 1) | 0;
                    }
                    let j = i;
                    for (; j - 1 > left; j = (j - 2) | 0) {
                        const above: number = $getDoubleIndex(from, j - 1);
                        const below: number = $getDoubleIndex(from, j - 2);
                        $putDoubleIndex(from, j, above);
                        $putDoubleIndex(from, j - 1, below);
                    }
                    if (j > left) $putDoubleIndex(from, j, $getDoubleIndex(from, j - 1));
                    $putDoubleIndex(from, left, x);
                }
                end = (limit - 1) | 0;
            }
            for (; end + 1 < count; end = (end + 1) | 0) {
                const x: number = $getDoubleIndex(from, end + 1);
                const y: number = $getDoubleIndex(from, end);
                if (saysLess($call<unknown>(f, undefined, x, y))) break;
            }
            if (begin > 0) {
                let a = previousBegin + begin;
                let b = begin + end + 1;
                power = 0;
                while (a >= count === b >= count) {
                    if (a >= count) {
                        a -= count;
                        b -= count;
                    }
                    a *= 2;
                    b *= 2;
                    power = (power + 1) | 0;
                }
            }
        }
        while (depth > 0) {
            const powerBelow: number = $getDoubleIndex(to, count + depth * 2 - 1);
            if (powerBelow <= power) break;
            depth = (depth - 1) | 0;
            const low: number = $getDoubleIndex(to, count + depth * 2) | 0;
            const middle = previousBegin;
            previousBegin = low;
            let left = (low + gallop($getDoubleIndex(from, middle), from, low, middle - low, 0, f, true)) | 0;
            if (left >= middle) continue;
            const high = (middle + gallop($getDoubleIndex(from, middle - 1), from, middle, previousEnd + 1 - middle, previousEnd - middle, f, false)) | 0;
            if (high <= middle) continue;
            const first = left;
            let right = middle;
            let t = left;
            merging: for (;;) {
                let leftWins = 0;
                let rightWins = 0;
                while (leftWins < minGallop && rightWins < minGallop) {
                    if (right >= high || left >= middle) break merging;
                    const x: number = $getDoubleIndex(from, left);
                    const y: number = $getDoubleIndex(from, right);
                    if (saysLess($call<unknown>(f, undefined, y, x))) {
                        $putDoubleIndex(to, t, y);
                        right = (right + 1) | 0;
                        rightWins = (rightWins + 1) | 0;
                        leftWins = 0;
                    } else {
                        $putDoubleIndex(to, t, x);
                        left = (left + 1) | 0;
                        leftWins = (leftWins + 1) | 0;
                        rightWins = 0;
                    }
                    t = (t + 1) | 0;
                }
                minGallop = (minGallop + 1) | 0;
                do {
                    if (minGallop > 1) minGallop = (minGallop - 1) | 0;
                    if (left >= middle || right >= high) break merging;
                    leftWins = gallop($getDoubleIndex(from, right), from, left, middle - left, 0, f, true);
                    for (let k = 0; k < leftWins; k = (k + 1) | 0, t = (t + 1) | 0, left = (left + 1) | 0) $putDoubleIndex(to, t, $getDoubleIndex(from, left));
                    $putDoubleIndex(to, t, $getDoubleIndex(from, right));
                    t = (t + 1) | 0;
                    right = (right + 1) | 0;
                    if (left >= middle || right >= high) break merging;
                    rightWins = gallop($getDoubleIndex(from, left), from, right, high - right, 0, f, false);
                    for (let k = 0; k < rightWins; k = (k + 1) | 0, t = (t + 1) | 0, right = (right + 1) | 0) $putDoubleIndex(to, t, $getDoubleIndex(from, right));
                    $putDoubleIndex(to, t, $getDoubleIndex(from, left));
                    t = (t + 1) | 0;
                    left = (left + 1) | 0;
                    if (left >= middle || right >= high) break merging;
                } while (leftWins >= 7 || rightWins >= 7);
                minGallop = (minGallop + 1) | 0;
            }
            for (; left < middle; left = (left + 1) | 0, t = (t + 1) | 0) $putDoubleIndex(to, t, $getDoubleIndex(from, left));
            for (; right < high; right = (right + 1) | 0, t = (t + 1) | 0) $putDoubleIndex(to, t, $getDoubleIndex(from, right));
            for (let k = first; k < high; k = (k + 1) | 0) $putDoubleIndex(from, k, $getDoubleIndex(to, k));
        }
        if (begin >= count) return;
        if (begin > 0) {
            if (to === from) to = $newDoubleArray(count + 72);
            $putDoubleIndex(to, count + depth * 2, previousBegin);
            $putDoubleIndex(to, count + depth * 2 + 1, power);
            depth = (depth + 1) | 0;
        }
        previousBegin = begin;
        previousEnd = end;
        begin = (end + 1) | 0;
    }
}

function insertDoubles(a: number[], n: number, f: unknown): void {
    for (let i = 1; i < n; i = (i + 1) | 0) {
        const x: number = $getDoubleIndex(a, i);
        let j = i;
        for (; j > 0; j = (j - 1) | 0) {
            const y: number = $getDoubleIndex(a, j - 1);
            if (!saysLess($call<unknown>(f, undefined, x, y))) break;
            $putDoubleIndex(a, j, y);
        }
        $putDoubleIndex(a, j, x);
    }
}

export function Array$sort<T>(a: T[], f: unknown): T[] {
    if (!isCallable(f)) return (a as any).sort(f, undefined);
    const n = a.length;
    if (n < 2) return a;
    if (isDoubleArray(a)) {
        const from: number[] = $newDoubleArray(n);
        let count = 0;
        for (let k = 0; k < n; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) continue;
            $putDoubleIndex(from, count, x);
            count = (count + 1) | 0;
        }
        sortDoubles(from, count, f);
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
    const from: T[] = $newContiguousArray<T>(n);
    let undefinedCount = 0;
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
    sortValues<T>(from, count, f);
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
    if (isDoubleArray(a)) {
        const from: number[] = $newDoubleArray(n);
        let count = 0;
        for (let k = 0; k < n; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) continue;
            $putDoubleIndex(from, count, x);
            count = (count + 1) | 0;
        }
        if (count !== n) return (a as any).toSorted(f, undefined);
        sortDoubles(from, count, f);
        return $truncateNewArray<T>(from as unknown as T[], n);
    }
    if (!isContiguousArray(a)) return (a as any).toSorted(f, undefined);
    const from: T[] = $newContiguousArray<T>(n);
    let count = 0;
    for (let k = 0; k < n; k++) {
        const has: boolean = $hasContiguousIndex(a, k);
        if (!has) continue;
        const x = $getContiguousIndex<T>(a, k);
        if (x === undefined) continue;
        $putContiguousIndex(from, count, x);
        count = (count + 1) | 0;
    }
    sortValues<T>(from, count, f);
    for (let k = count; k < n; k++) $putContiguousIndex(from, k, undefined);
    return $truncateNewArray<T>(from, n);
}

export function Array$sortByKey<T>(a: T[], f: unknown, name: unknown, flags: number): T[] {
    const n = a.length;
    if (n <= 16 && name === undefined && (flags & 8) === 0 && isDoubleArray(a)) {
        let k = 0;
        for (; k < n; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) break;
        }
        if (n < 2) return a;
        const isWritable: boolean = k === n && $tryPutIndex(a, 0, $getDoubleIndex(a, 0));
        if (isWritable && isDoubleArray(a) && a.length === n) {
            insertDoubles(a as unknown as number[], n, f);
            return a;
        }
    }
    const sorted: T[] | null = $trySortByKey<T>(a, name, flags);
    if (sorted !== null) return sorted;
    return (a as any).sort(f, undefined);
}

export function Array$toSortedByKey<T>(a: T[], f: unknown, name: unknown, flags: number): T[] {
    const n = a.length;
    if (n <= 16 && name === undefined && (flags & 8) === 0 && isDoubleArray(a)) {
        const from: number[] = $newDoubleArray(n);
        let k = 0;
        for (; k < n; k++) {
            const x: number = $getDoubleIndex(a, k);
            if (x !== x) break;
            $putDoubleIndex(from, k, x);
        }
        if (k === n) {
            insertDoubles(from, n, f);
            return $truncateNewArray<T>(from as unknown as T[], n);
        }
    }
    const sorted: T[] | null = $trySortByKey<T>(a, name, flags | 2);
    if (sorted !== null) return sorted;
    return (a as any).toSorted(f, undefined);
}

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
    if (m) {
        if (isDoubleArray(a)) {
            for (; k < m && isDoubleArray(a) && k < a.length; k++) {
                const x: number = $getDoubleIndex(a, k);
                if (x !== x) break;
                const y = $call<U>(f, thisArg, x, k & 0x7fffffff);
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
                const y = $call<U>(f, thisArg, $getContiguousIndex<T>(a, k), k & 0x7fffffff);
                const isStored: boolean = $tryPutByValDirect(out, k, y);
                if (!isStored) {
                    out[k++] = y;
                    break;
                }
            }
        }
    }
    for (; k < a.length; k++) out[k] = $callNoInline<U>(f, thisArg, $getIndex<T>(a, k), k);
    return $truncateNewArray<U>(out, k);
}
