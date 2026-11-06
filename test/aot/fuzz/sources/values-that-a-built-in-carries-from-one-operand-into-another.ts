// Fixed seeds of fuzz/values-that-a-built-in-carries-from-one-operand-into-another.ts: a value reaches an object only because a built-in function took it out of one of its operands.
import { Random } from "../random";
import {
  generate,
  generateWithOperandsThatHoldEachOther,
} from "../values-that-a-built-in-carries-from-one-operand-into-another";
import { family } from "../family";

export default family(
  "values that a built-in carries from one operand into another",
  Array.from({ length: 480 }, (_, index) => {
    // Every third program is about operands of one call that hold each other.
    const holdEachOther = index % 3 === 2;
    return {
      name: `seed ${index + 1}${holdEachOther ? ", the operands hold each other" : ""}.`,
      // Those programs, and every second one of the others, check while they run what the build took for proven.
      flags: holdEachOther || index % 2 === 0 ? ["--aot-validate"] : [],
      make: () => ({
        file: "main.mjs",
        text: (holdEachOther ? generateWithOperandsThatHoldEachOther : generate)(new Random(index + 1)),
      }),
    };
  }),
);
