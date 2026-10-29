import { tsconfig } from "../generators/every-way-to-look-at-an-object";
import { family } from "../family";
import { program } from "../generators/texts-parsed-as-a-drawn-type";

export default family(
  "text parsed as a type gives what plain JSON.parse gives",
  Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({ file: "main.ts", text: program(index + 1), files: { "tsconfig.json": tsconfig } }),
  })),
);
