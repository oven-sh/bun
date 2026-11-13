import type { Command } from "./method-literal-types";

export const one: Command = {
  name: "one",
  load: () =>
    Promise.resolve({
      async call(done, context) {
        done();
        return context.n + 1;
      },
    }),
};
