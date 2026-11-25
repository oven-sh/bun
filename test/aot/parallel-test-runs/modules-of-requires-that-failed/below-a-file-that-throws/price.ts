import { tax } from "./tax";

const runs = ((globalThis as any).priceRuns = ((globalThis as any).priceRuns ?? 0) + 1);
export const price = () => "price of run " + runs + ", " + tax();
