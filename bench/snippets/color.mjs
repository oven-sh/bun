import Color from "color";
import tinycolor from "tinycolor2";
import { bench, group, run } from "../runner.mjs";

const inputs = ["#f00", "rgb(255, 0, 0)", "rgba(255, 0, 0, 1)", "hsl(0, 100%, 50%)"];

for (const input of inputs) {
  group(`${input}`, () => {
    if (typeof Bun !== "undefined") {
      bench(`Bun.color() (${input})`, () => {
        Bun.color(input, "css");
      });
    }

    bench(`color (${input})`, () => {
      Color(input).hex();
    });

    bench(`'tinycolor2' (${input})`, () => {
      tinycolor(input).toHexString();
    });
  });
}

await run();
