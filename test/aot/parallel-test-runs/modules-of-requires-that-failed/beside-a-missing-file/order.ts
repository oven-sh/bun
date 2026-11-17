import { price } from "./price";

const runs = ((globalThis as any).orderRuns = ((globalThis as any).orderRuns ?? 0) + 1);
export const order = () => "order of run " + runs + ", " + price();
