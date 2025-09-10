// Benchmark for string fast path optimization in postMessage and structuredClone

import { bench, run } from "mitata";

// Test strings of different sizes
const strings = {
  small: "Hello world",
  medium: "Hello World!!!".repeat(1024).split("").join(""),
  large: "Hello World!!!".repeat(1024).repeat(1024).split("").join(""),
};

console.log("String fast path benchmark");
console.log("Comparing pure strings (fast path) vs objects containing strings (traditional)");
console.log("For structuredClone, pure strings should have constant time regardless of size.");
console.log("");

// Benchmark structuredClone with pure strings (uses fast path)
bench("structuredClone small string (fast path)", () => {
  structuredClone(strings.small);
});

bench("structuredClone medium string (fast path)", () => {
  structuredClone(strings.medium);
});

bench("structuredClone large string (fast path)", () => {
  structuredClone(strings.large);
});

// Benchmark structuredClone with objects containing strings (traditional path)
bench("structuredClone object with small string", () => {
  structuredClone({ str: strings.small });
});

bench("structuredClone object with medium string", () => {
  structuredClone({ str: strings.medium });
});

bench("structuredClone object with large string", () => {
  structuredClone({ str: strings.large });
});

// Multiple string cloning benchmark
bench("structuredClone 100 small strings", () => {
  for (let i = 0; i < 100; i++) {
    structuredClone(strings.small);
  }
});

bench("structuredClone 100 small objects", () => {
  for (let i = 0; i < 100; i++) {
    structuredClone({ str: strings.small });
  }
});

await run();
