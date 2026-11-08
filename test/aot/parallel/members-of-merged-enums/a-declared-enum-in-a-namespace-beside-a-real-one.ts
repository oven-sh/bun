namespace Shelf {
  export declare enum Mode { Off, Fast }
  export enum Mode { Slow = 2 }
}
console.log(Shelf.Mode.Fast === 1 ? "folded" : "read at run time", String(Shelf.Mode.Fast), Shelf.Mode.Slow);
