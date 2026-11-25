import { rate, under } from "@made-up/tax";
import * as fx from "@made-up/fx";
console.log("sale runs", rate, fx.rate);
export const sold = () => [rate, under(), fx.rate].join();
