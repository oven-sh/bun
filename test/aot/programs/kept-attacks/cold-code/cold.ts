// Cold code, one probe of many. It prints what plain Bun prints.
interface Type { flags: number; types?: Type[] }
function every<T>(array: readonly T[] | undefined, callback: (element: T, index: number) => boolean): boolean {
  if (array !== undefined) {
    for (let i = 0; i < array.length; i++) {
      if (!callback(array[i], i)) return false;
    }
  }
  return true;
}
function everyType(type: Type, f: (t: Type) => boolean): boolean {
  return type.flags & 1 ? every(type.types, f) : f(type);
}
function check(type: Type, kind: number): boolean {
  let seen = 0;
  const all = everyType(type, t => { seen++; return t.flags > kind; });
  return all && seen > 0;
}
console.log(check({ flags: 1, types: [{ flags: 2 }, { flags: 4 }] }, 0), check({ flags: 2 }, 0), every([1, 2], n => n > 0));
