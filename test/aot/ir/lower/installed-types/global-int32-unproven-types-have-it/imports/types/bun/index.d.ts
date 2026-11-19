declare module "bun" {
  type int32 = number;
  function inspect(value: unknown): string;
}
