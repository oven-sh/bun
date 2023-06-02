import { expectType } from "tsd";

declare module "bun" {
  export interface Env {
    FOO: "FOO";
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BAR: "BAR";
    }
  }
}

expectType<"FOO">(process.env.FOO);
expectType<"BAR">(process.env.BAR);

process.env.FOO;
process.env.BAR;
process.env.OTHER;
Bun.env.FOO;
Bun.env.BAR;
