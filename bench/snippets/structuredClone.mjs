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

bench("structuredClone(array)", () => structuredClone(testArray));
bench("structuredClone(123)", () => structuredClone(123));
bench("structuredClone({a: 123})", () => structuredClone({ a: 123 }));
await run();
