declare module "bun" {
  import * as BunModule from "bun";

  type int32 = number & { readonly "bun.int32"?: true };

  global {
    export import Bun = BunModule;
  }
}

declare module "bun:bundle" {
  interface Registry {}

  function feature(flag: Registry extends { features: infer Features extends string } ? Features : string): boolean;
}
