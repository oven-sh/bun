import { rate, fee } from "./tax.cjs";
export const sold = () => [rate, fee()].join();
