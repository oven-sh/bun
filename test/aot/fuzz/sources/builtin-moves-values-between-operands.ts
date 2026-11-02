// A fixed list of seeds of ../builtin-moves-values-between-operands.ts, which describes the programs.
import { Random } from "../random";
import {
  generate,
  generateWithOperandsThatHoldEachOther,
} from "../builtin-moves-values-between-operands";
import { family } from "../family";

export default family(
  "builtin moves values between operands",
  Array.from({ length: 480 }, (_, index) => {
    // Every third program is about operands of one call that reference each other.
    const holdEachOther = index % 3 === 2;
    return {
      name: `seed ${index + 1}${holdEachOther ? ", the operands hold each other" : ""}.`,
      // Those programs, and every second one of the others, are built with --aot-validate.
      flags: holdEachOther || index % 2 === 0 ? ["--aot-validate"] : [],
      make: () => ({
        file: "main.mjs",
        text: (holdEachOther ? generateWithOperandsThatHoldEachOther : generate)(new Random(index + 1)),
      }),
    };
  }),
);
