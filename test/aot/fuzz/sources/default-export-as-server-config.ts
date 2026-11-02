// A fixed list of seeds of ../default-export-as-server-config.ts, which describes the programs.
import { generate } from "../default-export-as-server-config";
import { Random } from "../random";
import { family } from "../family";

const onceWrong = [19, 28, 32, 54, 74, 107, 111, 112, 114, 115, 135, 144];

export default family(
  "default export as server config",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags: onceWrong.includes(index + 1)
      ? []
      : index % 4 === 3
        ? ["--aot-heat=everything-is-hot"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-cold"]
          : [],
    make: () => generate(new Random(index + 1)),
  })),
);
