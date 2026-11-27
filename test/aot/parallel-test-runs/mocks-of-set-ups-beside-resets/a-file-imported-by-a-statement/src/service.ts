import { price } from "./lib.ts";

const runs = ((globalThis as any).runs = ((globalThis as any).runs ?? 0) + 1);
export const service = () => "run " + runs + " reads " + price();
