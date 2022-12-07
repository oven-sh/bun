import { expectType } from "tsd";

declare global {
  namespace Bun {
    interface Env {
      WHATEVER: "WHATEVER";
    }
  }
}

expectType<"WHATEVER">(process.env.WHATEVER);

export {};
