import { IS_MAIN } from "../main.ts";

export const load = async (): Promise<string> => (IS_MAIN ? "nothing is loaded" : (await import("./never-loaded.ts")).text);
export const loadOther = async (): Promise<string> => (IS_MAIN ? (await import("./loaded.ts")).text : "nothing is loaded");
