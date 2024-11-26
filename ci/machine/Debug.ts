import { getEnv } from "./context/process.ts";

export const isDebug = getEnv("DEBUG", false) === "1";

export { debugLog } from "../../scripts/utils.mjs";
