declare global {
  interface JSON {
    parse<T>(text: string): T;
  }
}
const text: string = '"text"';
const parse: <T>(text: string) => T = JSON.parse;
console.log(parse<number>(text));
export {};
