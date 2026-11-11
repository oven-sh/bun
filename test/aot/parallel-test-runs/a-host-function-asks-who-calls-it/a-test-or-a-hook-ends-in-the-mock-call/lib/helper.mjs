import { mock } from "bun:test";
const beside = "./shared.mjs";
export const mockBesideHelper = () => mock.module(beside, () => ({ x: "mocked" }));
export const readHook = () => import("./hook.mjs").then(module => module.x);
export const readRow = () => import("./row.mjs").then(module => module.x);
