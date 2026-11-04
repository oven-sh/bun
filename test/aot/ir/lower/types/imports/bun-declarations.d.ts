declare module "bun" {
  type int32 = number & { readonly "bun.int32"?: true };
}
