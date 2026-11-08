// A fixed list of seeds of ../member-between-getter-and-setter.ts, which describes the programs.
import { generate } from "../member-between-getter-and-setter";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "member between getter and setter",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => generate(new Random(index + 1)),
  })),
);
