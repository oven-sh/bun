import { jest } from "bun:test";
const fake = jest.useFakeTimers;
fake.call(jest);
let fired = 0;
setTimeout(() => fired++, 10).unref();
jest.advanceTimersByTime(10);
console.log(fired);
jest.useRealTimers();
