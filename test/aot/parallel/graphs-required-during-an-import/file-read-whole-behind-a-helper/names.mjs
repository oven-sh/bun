export { second } from "./second.cjs";
import settings from "./second.cjs";
import os from "node:os";
export const names = [settings.second, settings.more, typeof os].join();
