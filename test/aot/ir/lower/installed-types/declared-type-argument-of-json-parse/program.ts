// a type argument that the program declares is erased: console.log(JSON.parse<number>(text), JSON.parse<Map<string, Date>>(text), JSON.parse<() => void>(text));
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

declare global {
  interface JSON {
    parse<T>(text: string): T;
  }
}
const text: string = '"text"';
console.log(JSON.parse<number>(text), JSON.parse<Map<string, Date>>(text), JSON.parse<() => void>(text));
export {};
