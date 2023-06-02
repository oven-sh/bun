import { expectType } from "tsd";

declare module "bun" {
  export interface Env {
    WHATEVER: "WHATEVER";
  }
}

expectType<"WHATEVER">(process.env.WHATEVER);

export {};
new Bun.Transpiler({
  macro: {
    "react-relay": {
      graphql: "bun-macro-relay/bun-macro-relay.tsx",
    },
  },
});

Event;
