import { log } from "./logger";
(globalThis as any).__config = { region: "eu" };
export const setUp = () => log("set up");
