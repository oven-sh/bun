import { ms } from "ms";
import { bench, group, run } from "../runner.mjs";

const stringInputs = ["1s", "1m", "1h", "1d", "1w", "1y", "2 days", "10h", "2.5 hrs", "1.5h", "100ms"];
const numberInputs = [1000, 60000, 3600000, 86400000, 604800000];

// if (typeof Bun == "undefined")
group("ms (npm)", () => {
  bench(`${stringInputs.length + numberInputs.length} inputs`, () => {
    for (const input of stringInputs) {
      ms(input);
    }
    for (const num of numberInputs) {
      ms(num);
    }
  });
  bench("string -> num", () => {
    ms(stringInputs[0]);
  });
  bench("num -> string", () => {
    ms(numberInputs[0]);
  });
});
if (typeof Bun != "undefined") {
  group("Bun.ms", () => {
    bench(`${stringInputs.length + numberInputs.length} inputs`, () => {
      for (const input of stringInputs) {
        Bun.ms(input);
      }
      for (const num of numberInputs) {
        Bun.ms(num);
      }
    });

    bench("string -> num", () => {
      Bun.ms(stringInputs[0]);
    });
    bench("num -> string", () => {
      Bun.ms(numberInputs[0]);
    });

    bench("statically inlined", () => {
      Bun.ms("1s");
      Bun.ms("1m");
      Bun.ms("1h");
      Bun.ms("1d");
      Bun.ms("1w");
      Bun.ms("1y");
      Bun.ms("2 days");
      Bun.ms("10h");
      Bun.ms("2.5 hrs");
      Bun.ms("1.5h");
      Bun.ms("100ms");

      Bun.ms(1000);
      Bun.ms(60000);
      Bun.ms(3600000);
      Bun.ms(86400000);
      Bun.ms(604800000);
    });
  });
}

await run();
