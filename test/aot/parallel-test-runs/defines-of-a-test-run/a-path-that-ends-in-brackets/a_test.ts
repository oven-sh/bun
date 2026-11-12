// `bun test` has `["name"]` as `.name` by the time it looks a path up among the defines.
import { test } from "bun:test";
import { read } from "./product.ts";
declare const config: { flat: string; level: { deep: string } };
(globalThis as any).config = { flat: "run", level: { deep: "run" } };
test("a path that ends in brackets", () => {
  console.log(config.flat, config["flat"], config[`flat`], (config)[("flat")], config?.flat);
  console.log(config.level.deep, config["level"].deep, config.level["deep"], config["level"]["deep"]);
  console.log(process.env.MADE_UP, process["env"].MADE_UP, process.env["MADE_UP"]);
  console.log(read());
});
