/// <reference path="./bun.ns.d.ts" />
declare module "bun" {
  function inspect(value: unknown): string;
  namespace Serve {
    interface Options {
      port: number;
    }
  }
}
