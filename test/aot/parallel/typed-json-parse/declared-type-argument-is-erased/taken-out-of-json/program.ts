declare global {
  interface JSON {
    parse<T>(text: string): T;
  }
}
const text: string = '"text"';
const { parse } = JSON;
console.log(parse<number>(text), globalThis.JSON.parse<number>(text));
export {};
