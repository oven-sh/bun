// How a program is compiled hangs on its own text alone. With a tsconfig.json the checker lists every file of the folder, so a file that the program never
// imports moves the numbers of the files behind it. Such a number went into the identity of a layout in two places, and the layouts were numbered by it:
//
//   a literal that writes functions alone    its layout belongs to the file that writes it
//   a key that is a created symbol           it is named by the file that creates it
//
// The engine then chose by the numbers of layouts: of the records that may arrive at a `for (const key in record)` it laid the turns out for the first.
//
// No name of the file does better than a hash of its number: its path on disk moves with the folder, and its path from the root of the project with the folder
// in which the build is started. The file breaks ties alone now, in the order of the files.
//
//   the same       the program that the front end hands to the engine (--aot-out), byte for byte; where the build is started elsewhere, its layouts in their order
//   the control    a file that the program does import changes it
import { expect } from "bun:test";
import { tempDir } from "harness";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../engine/testaot";
import { withProgramOutput } from "../harness/flags";
import { test } from "../supported";
import { build } from "./measure";

const program = {
  "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "module": "Preserve", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "noEmit": true, "strict": true } }`,
  "marks.ts": `
    export const red = Symbol("red");
    export const green = Symbol("green");
    export const blue = Symbol("blue");
    export const makers = { red() { return red; }, green() { return green; } };`,
  "more-marks.js": `
    export const round = Symbol("red");
    export const square = Symbol("green");
    export const shapes = { round() { return round; }, square() { return square; }, both() { return [round, square]; } };`,
  "holders.ts": `
    import { red, green, blue } from "./marks.ts";
    import { round, square } from "./more-marks.js";
    export const list = [
      { [red]: 1, a: 1 }, { [green]: 2, b: 1 }, { [blue]: 3, c: 1 }, { [round]: 4, d: 1 }, { [square]: 5, e: 1 },
      { [red]: 1, [round]: 2 }, { [green]: 1, [square]: 2 }, { [blue]: 1, [round]: 2, [square]: 3 },
      // Alike but for the file that creates the symbol: each is the first that its file creates, and both are called "red".
      { [red]: 1 }, { [round]: 1 }, { [red]: 1, z: 1 }, { [round]: 1, z: 1 },
      // Alike but for the file that creates the second symbol.
      { [red]: 1, [green]: 2 }, { [red]: 1, [square]: 2 }, { [red]: 1, [green]: 2, y: 1 }, { [red]: 1, [square]: 2, y: 1 }, { [red]: 1, [green]: 2, x: 1 }, { [red]: 1, [square]: 2, x: 1 },
    ];
    export const first = { open() { return 1; }, shut() { return 2; } };
    export const second = { open() { return 3; }, turn() { return 4; }, stop() { return 5; } };
    export const third = { go() { return 6; } };
    export function names(of: object) {
      let text = "";
      for (const name in of) text += name;
      return text;
    }`,
  "holders-too.js": `
    import { red, blue } from "./marks.ts";
    import { round } from "./more-marks.js";
    export const more = [{ [red]: 1, f: 1 }, { [blue]: 1, g: 1 }, { [round]: 1, h: 1 }, { [red]: 1, [blue]: 2, [round]: 3 }];
    export const fourth = { open() { return 7; }, shut() { return 8; } };
    export const fifth = { left() { return 9; }, right() { return 10; } };`,
  "entry.ts": `
    import { list, first, second, third, names } from "./holders.ts";
    import { more, fourth, fifth } from "./holders-too.js";
    import { makers } from "./marks.ts";
    import { shapes } from "./more-marks.js";
    console.log(list.length + more.length, names(first), names(second), names(third), names(fourth), names(fifth), names(makers), names(shapes));`,
};
// One sorts in front of every file of the program and one behind them all.
const lyingBeside = {
  "0-in-front.ts": `export const unrelated = { never() { return 0; } };`,
  "zz-behind.js": `export const mark = Symbol("unrelated");\nexport const holder = { [mark]: 1 };`,
};

test("files that merely lie in the folder change nothing of the program", async () => {
  using above = tempDir("aot-files-that-lie-beside", { inner: program });
  using elsewhere = tempDir("aot-the-same-files-in-a-folder-of-another-name-and-another-length", program);
  const folder = join(String(above), "inner");
  const handedOver = async (startedIn = folder, entry = "./entry.ts") => {
    const wire = join(startedIn, "program.ir");
    await build({ folder: startedIn, entry }, [withProgramOutput(wire)]);
    const bytes = readFileSync(wire);
    const { lines, exitCode } = await run("print", wire);
    expect(exitCode).toBe(0);
    rmSync(wire);
    const layouts = lines.filter(line => line.startsWith("layout "));
    expect(layouts.length).toBeGreaterThan(10);
    return { bytes: `${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")} ${bytes.length}`, layouts };
  };
  const alone = await handedOver();
  expect((await handedOver()).bytes).toBe(alone.bytes);
  expect((await handedOver(String(elsewhere))).bytes).toBe(alone.bytes);
  // The program names its files from the folder in which the build is started, so its bytes differ.
  expect((await handedOver(String(above), "./inner/entry.ts")).layouts).toEqual(alone.layouts);
  for (const [name, text] of Object.entries(lyingBeside)) writeFileSync(join(folder, name), text);
  expect((await handedOver()).bytes).toBe(alone.bytes);
  writeFileSync(join(folder, "entry.ts"), `import "./0-in-front.ts";\n${program["entry.ts"]}`);
  expect((await handedOver()).bytes).not.toBe(alone.bytes);
});
