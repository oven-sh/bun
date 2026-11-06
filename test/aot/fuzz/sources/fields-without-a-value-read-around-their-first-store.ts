// fuzz/fields-without-a-value-read-around-their-first-store.ts: static fields and fields of instances that are written without a value, as `accessor` fields, private names and
// ordinary names, with a type or with the type that the checker takes from the stores. Methods that run between the members print what they read ahead of the first store, between the stores and behind them.
import { generate, options } from "../fields-without-a-value-read-around-their-first-store";
import { Random } from "../random";
import { endless } from "../family";

export default endless("fields without a value, read around their first store", index => {
  // Programs share an executable with those of the same tsconfig.json, so the options come in runs of four.
  const option = options[Math.floor(index / 4) % options.length];
  return {
    name: `seed ${index + 1}, ${option}.`,
    make: () => ({ file: "main.ts", ...generate(new Random(index + 1), option) }),
  };
});
