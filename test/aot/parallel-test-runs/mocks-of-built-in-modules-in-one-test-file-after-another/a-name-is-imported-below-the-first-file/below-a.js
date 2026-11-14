import { existsSync } from "node:fs";
export const seen = () => existsSync("/nowhere");
