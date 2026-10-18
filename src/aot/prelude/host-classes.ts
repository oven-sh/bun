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
