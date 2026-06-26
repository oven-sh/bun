// Benchmark for [...set] optimization (WebKit#56539)
// https://github.com/WebKit/WebKit/pull/56539
import { bench, run } from "../runner.mjs";

const intSet10 = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const intSet100 = new Set(Array.from({ length: 100 }, (_, i) => i));
const strSet10 = new Set(Array.from({ length: 10 }, (_, i) => `key-${i}`));
const strSet100 = new Set(Array.from({ length: 100 }, (_, i) => `key-${i}`));

const objSet10 = new Set(Array.from({ length: 10 }, (_, i) => ({ id: i })));
const objSet100 = new Set(Array.from({ length: 100 }, (_, i) => ({ id: i })));

bench("[...set] - integers (10)", () => [...intSet10]);
bench("[...set] - integers (100)", () => [...intSet100]);
bench("[...set] - strings (10)", () => [...strSet10]);
bench("[...set] - strings (100)", () => [...strSet100]);
bench("[...set] - objects (10)", () => [...objSet10]);
bench("[...set] - objects (100)", () => [...objSet100]);

await run();
