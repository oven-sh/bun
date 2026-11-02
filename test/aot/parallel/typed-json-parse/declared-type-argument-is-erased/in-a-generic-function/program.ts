declare global {
  interface JSON {
    parse<T>(text: string): T;
  }
}
const text: string = '"text"';
function load<T>(from: string): T {
  return JSON.parse<T>(from);
}
console.log(load<number>(text));
export {};
