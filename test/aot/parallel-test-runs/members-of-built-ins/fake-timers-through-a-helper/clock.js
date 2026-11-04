import { vi } from "bun:test";

const tools = [vi];
export const freeze = () => tools[0].useFakeTimers();
export const advance = ms => tools[0].advanceTimersByTime(ms);
export const thaw = () => tools[0].useRealTimers();
