import type { Command } from "./method-literal-types";

export const two: Command = {
  name: "two",
  load: () =>
    Promise.resolve({
      async call(done, context) {
        done();
        return context.n + 2;
      },
    }),
};
