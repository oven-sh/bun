declare global {
  var insideTheBlock: number;
}

declare module "an-ambient-module" {
  export const value: number;
}

declare var besideTheBlock: number;
