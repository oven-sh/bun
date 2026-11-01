declare module "a-module-that-only-a-declaration-of-this-test-knows" {
  export class Widget {
    name: string;
  }
  export function make(): Widget;
}
