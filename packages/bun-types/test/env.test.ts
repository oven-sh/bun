import { expectType } from "./utilities.test";

declare module "bun" {
  interface Env {
    FOO: "FOO";
  }
}
expectType<"FOO">(process.env.FOO);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      BAR: "BAR";
    }
  }
}

expectType<"BAR">(process.env.BAR);

process.env.FOO;
process.env.BAR;
process.env.OTHER;
Bun.env.FOO;
Bun.env.BAR;
