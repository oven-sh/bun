import { bench, run } from "./runner.mjs";
import npmStringWidth from "string-width";

const bunStringWidth = globalThis?.Bun?.stringWidth;

bench("npm/string-width (ansi + emoji + ascii)", () => {
  npmStringWidth("hello there! 😀\u001b[31m😀😀");
});

bench("npm/string-width (ansi + emoji)", () => {
  npmStringWidth("😀\u001b[31m😀😀");
});

bench("npm/string-width (ansi + ascii)", () => {
  npmStringWidth("\u001b[31mhello there!");
});

if (bunStringWidth) {
  bench("Bun.stringWidth (ansi + emoji + ascii)", () => {
    bunStringWidth("hello there! 😀\u001b[31m😀😀");
  });

  bench("Bun.stringWidth (ansi + emoji)", () => {
    bunStringWidth("😀\u001b[31m😀😀");
  });

  bench("Bun.stringWidth (ansi + ascii)", () => {
    bunStringWidth("\u001b[31mhello there!");
  });

  if (npmStringWidth("😀\u001b[31m😀😀") !== bunStringWidth("😀\u001b[31m😀😀")) {
    console.error("string-width mismatch");
  }

  if (npmStringWidth("hello there! 😀\u001b[31m😀😀") !== bunStringWidth("hello there! 😀\u001b[31m😀😀")) {
    console.error("string-width mismatch");
  }

  if (npmStringWidth("\u001b[31mhello there!") !== bunStringWidth("\u001b[31mhello there!")) {
    console.error("string-width mismatch");
  }
}

await run();
