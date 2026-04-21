var testArray = [
  {
    description: "Random description.",
    testNumber: 123456789,
    testBoolean: true,
    testObject: {
      testString: "test string",
      testNumber: 12345,
    },
    testArray: [
      {
        myName: "test name",
        myNumber: 123245,
      },
    ],
  },
  {
    description: "Random description.",
    testNumber: 123456789,
    testBoolean: true,
    testObject: {
      testString: "test string",
      testNumber: 12345,
    },
    testArray: [
      {
        myName: "test name",
        myNumber: 123245,
      },
    ],
  },
];

import { bench, run } from "../runner.mjs";

bench("structuredClone(nested array)", () => structuredClone(testArray));
bench("structuredClone(123)", () => structuredClone(123));
bench("structuredClone({a: 123})", () => structuredClone({ a: 123 }));

// Array fast path targets
var numbersSmall = Array.from({ length: 10 }, (_, i) => i);
var numbersMedium = Array.from({ length: 100 }, (_, i) => i);
var numbersLarge = Array.from({ length: 1000 }, (_, i) => i);
var stringsSmall = Array.from({ length: 10 }, (_, i) => `item-${i}`);
var stringsMedium = Array.from({ length: 100 }, (_, i) => `item-${i}`);
var mixed = [1, "hello", true, null, undefined, 3.14, "world", false, 42, "test"];

bench("structuredClone([10 numbers])", () => structuredClone(numbersSmall));
bench("structuredClone([100 numbers])", () => structuredClone(numbersMedium));
bench("structuredClone([1000 numbers])", () => structuredClone(numbersLarge));
bench("structuredClone([10 strings])", () => structuredClone(stringsSmall));
bench("structuredClone([100 strings])", () => structuredClone(stringsMedium));
bench("structuredClone([10 mixed])", () => structuredClone(mixed));

// Array of objects (DenseArray fast path target)
var objectsSmall = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `item-${i}`, active: true }));
var objectsMedium = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}`, active: true }));

bench("structuredClone([10 objects])", () => structuredClone(objectsSmall));
bench("structuredClone([100 objects])", () => structuredClone(objectsMedium));

await run();
