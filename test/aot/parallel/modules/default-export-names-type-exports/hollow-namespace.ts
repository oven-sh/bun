namespace Only {
  export type Inner = number;
  export namespace Deeper {
    export interface Leaf {
      a: number;
    }
  }
}
export default Only;
console.log("hollow namespace");
