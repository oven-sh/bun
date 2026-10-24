// Methods found through instances: replace, split, match, search and matchAll call the method under their well-known symbol with the string (and more), while the program's own calls pass numbers.
let total = 0;

class Matcher {
  [Symbol.replace](text: number, replacement: number): string {
    total += typeof text === "number" ? 1 : typeof text === "string" ? 100 : 10000;
    return typeof replacement === "number" ? "n" : typeof replacement;
  }
  [Symbol.split](text: number, limit: number): string[] {
    total += typeof limit === "number" ? 100000 : limit === undefined ? 1000000 : 0;
    return [typeof text];
  }
  [Symbol.search](text: number): number {
    return typeof text === "number" ? text : -5;
  }
  get [Symbol.match](): boolean {
    total += 10000000;
    return false;
  }
}

const matcher = new Matcher();
matcher[Symbol.replace](1, 2);
matcher[Symbol.split](1, 2);
matcher[Symbol.search](3);
const any: any = matcher;
const results: unknown[] = ["abc".replace(any, "x"), "abc".replace(any, () => "y"), "abc".replaceAll(any, "z"), "abc".split(any), "abc".split(any, 2), "abc".search(any), "[object Object]".startsWith(any), "abc".includes(any)];
console.log(total, results.join());
