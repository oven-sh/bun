const offsetBase = 2097152;

export function plainPathname(input: string, offsets: number): string {
    return input.slice(Math.floor(offsets / (offsetBase * offsetBase)), Math.floor(offsets / offsetBase) % offsetBase);
}

export function plainSearch(input: string, offsets: number): string {
    const query = Math.floor(offsets / offsetBase) % offsetBase;
    const end = offsets % offsetBase;
    return query + 1 < end ? input.slice(query, end) : "";
}

export function plainSearchParam(constructor: any, input: string, found: number, name: any): any {
    if (found >= 0) return input.slice(Math.floor(found / offsetBase), found % offsetBase);
    return found === -1 ? null : new constructor(input).searchParams.get(name);
}

export function plainSearchParamWithBase(constructor: any, input: string, found: number, name: any, base: any): any {
    if (found >= 0) return input.slice(Math.floor(found / offsetBase), found % offsetBase);
    return found === -1 ? null : new constructor(input, base).searchParams.get(name);
}

export function hasPlainSearchParamWithBase(constructor: any, input: string, found: number, name: any, base: any): any {
    return found >= -1 ? found >= 0 : new constructor(input, base).searchParams.has(name);
}

export function plainQueryText(input: string): string {
    return input.charCodeAt(0) === 63 ? input.slice(1) : input;
}

export function plainQueryParam(constructor: any, input: string, found: number, name: any): any {
    if (found >= 0) return input.slice(Math.floor(found / offsetBase), found % offsetBase);
    return found === -1 ? null : new constructor(input).get(name);
}

export function hasPlainQueryParam(constructor: any, input: string, found: number, name: any): any {
    return found >= -1 ? found >= 0 : new constructor(input).has(name);
}

export function hasPlainSearchParam(constructor: any, input: string, found: number, name: any): any {
    return found >= -1 ? found >= 0 : new constructor(input).searchParams.has(name);
}

function isPlainQueryText(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || code === 45 || code === 46 || code === 95 || code === 42)) return false;
    }
    return true;
}

function queryTextOf(value: any): string {
    if (typeof value === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
    const text = `${value}`;
    return isPlainQueryText(text) ? text : text.toWellFormed();
}

export function appendQueryPair(pairs: string[], name: any, value: any): undefined {
    const key = queryTextOf(name);
    pairs.push(key, queryTextOf(value));
}

export function setQueryPair(pairs: string[], name: any, value: any): undefined {
    const key = queryTextOf(name);
    const text = queryTextOf(value);
    for (let i = 0; i < pairs.length; i += 2) {
        if (pairs[i] !== key) continue;
        pairs[i + 1] = text;
        let kept = i + 2;
        for (let j = kept; j < pairs.length; j += 2) {
            if (pairs[j] === key) continue;
            pairs[kept] = pairs[j];
            pairs[kept + 1] = pairs[j + 1];
            kept += 2;
        }
        pairs.length = kept;
        return;
    }
    pairs.push(key, text);
}

export function builtQueryText(constructor: any, pairs: string[]): string {
    let text = "";
    for (let i = 0; i < pairs.length; i += 2) {
        const key = pairs[i];
        const value = pairs[i + 1];
        if (!isPlainQueryText(key) || !isPlainQueryText(value)) {
            const entries: string[][] = [];
            for (let j = 0; j < pairs.length; j += 2) entries.push([pairs[j], pairs[j + 1]]);
            return new constructor(entries).toString();
        }
        text += i === 0 ? `${key}=${value}` : `&${key}=${value}`;
    }
    return text;
}
