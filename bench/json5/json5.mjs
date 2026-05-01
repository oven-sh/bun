import JSON5 from "json5";
import { bench, group, run } from "../runner.mjs";

const isBun = typeof Bun !== "undefined" && Bun.JSON5;

function sizeLabel(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

// -- parse inputs --

const smallJson5 = `{
  // User profile
  name: "John Doe",
  age: 30,
  email: 'john@example.com',
  active: true,
}`;

function generateLargeJson5(count) {
  const lines = ["{\n  // Auto-generated dataset\n  items: [\n"];
  for (let i = 0; i < count; i++) {
    lines.push(`    {
      id: ${i},
      name: 'item_${i}',
      value: ${(Math.random() * 1000).toFixed(2)},
      hex: 0x${i.toString(16).toUpperCase()},
      active: ${i % 2 === 0},
      tags: ['tag_${i % 10}', 'category_${i % 5}',],
      // entry ${i}
    },\n`);
  }
  lines.push("  ],\n  total: " + count + ",\n  status: 'complete',\n}\n");
  return lines.join("");
}

const largeJson5 = generateLargeJson5(6500);

// -- stringify inputs --

const smallObject = {
  name: "John Doe",
  age: 30,
  email: "john@example.com",
  active: true,
};

const largeObject = {
  items: Array.from({ length: 10000 }, (_, i) => ({
    id: i,
    name: `item_${i}`,
    value: +(Math.random() * 1000).toFixed(2),
    active: i % 2 === 0,
    tags: [`tag_${i % 10}`, `category_${i % 5}`],
  })),
  total: 10000,
  status: "complete",
};

const stringify = isBun ? Bun.JSON5.stringify : JSON5.stringify;

// -- parse benchmarks --

group(`parse small (${sizeLabel(smallJson5.length)})`, () => {
  if (isBun) bench("Bun.JSON5.parse", () => Bun.JSON5.parse(smallJson5));
  bench("json5.parse", () => JSON5.parse(smallJson5));
});

group(`parse large (${sizeLabel(largeJson5.length)})`, () => {
  if (isBun) bench("Bun.JSON5.parse", () => Bun.JSON5.parse(largeJson5));
  bench("json5.parse", () => JSON5.parse(largeJson5));
});

// -- stringify benchmarks --

group(`stringify small (${sizeLabel(stringify(smallObject).length)})`, () => {
  if (isBun) bench("Bun.JSON5.stringify", () => Bun.JSON5.stringify(smallObject));
  bench("json5.stringify", () => JSON5.stringify(smallObject));
});

group(`stringify large (${sizeLabel(stringify(largeObject).length)})`, () => {
  if (isBun) bench("Bun.JSON5.stringify", () => Bun.JSON5.stringify(largeObject));
  bench("json5.stringify", () => JSON5.stringify(largeObject));
});

await run();
