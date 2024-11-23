import { getEnv } from "./context/Process";

export const isDebug = getEnv("DEBUG", false) === "1";

export { debugLog } from "../../scripts/utils.mjs";
