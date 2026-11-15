import { rate } from "tax";
import * as fx from "fx";
console.log("sale runs", rate, fx.rate);
export const sold = () => [rate, fx.rate].join();
