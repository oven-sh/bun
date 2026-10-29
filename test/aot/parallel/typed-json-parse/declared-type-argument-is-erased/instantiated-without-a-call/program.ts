declare global {
  interface JSON {
    parse<T>(text: string): T;
  }
}
const text: string = '"text"';
const parse = JSON.parse<number>;
console.log(parse(text), [text].map(JSON.parse<number>));
export {};
