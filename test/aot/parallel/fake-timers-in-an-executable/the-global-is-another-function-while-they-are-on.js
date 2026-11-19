import { jest } from "bun:test";
const real = setTimeout;
jest.useFakeTimers();
console.log(setTimeout === real, globalThis.setTimeout === real);
jest.useRealTimers();
console.log(setTimeout === real, globalThis.setTimeout === real);
