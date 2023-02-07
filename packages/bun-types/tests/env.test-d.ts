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
new Bun.Transpiler({
  macro: {
    "react-relay": {
      graphql: "bun-macro-relay/bun-macro-relay.tsx",
    },
  },
});

Event;
