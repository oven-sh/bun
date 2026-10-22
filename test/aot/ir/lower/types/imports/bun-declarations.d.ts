declare module "bun" {
  type int32 = number & { readonly "bun.int32"?: true };
  namespace Schema {
    type Min<N extends number> = { readonly "bun.min"?: N };
  }
}
