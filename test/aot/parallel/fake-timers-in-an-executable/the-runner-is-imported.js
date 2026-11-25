import { jest } from "bun:test";
jest.useFakeTimers();
let fired = 0;
setTimeout(() => fired++, 1000).unref();
jest.advanceTimersByTime(1000);
console.log(fired, jest.getTimerCount());
jest.useRealTimers();
