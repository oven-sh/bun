import * as all from "bun";
import bun from "bun";
noteStart();
export const read = () => [all.custom, all.other, bun.custom].join();
