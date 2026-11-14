import { rate } from "@made-up/tax";
import { side } from "./side.mjs";
import * as absent from "@made-up/absent";
export const sold = () => [rate, side, absent].length;
