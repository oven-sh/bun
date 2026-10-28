// A frame names its file with the folder in which the file lies, and the files of an executable lie in another folder than those that plain Bun runs. So a program that prints frames
// cuts the folder off. Windows divides the folders by `\`, and only a part of the programs is run there. Here plain Bun runs each program that reads a stack and looks for a `/`, with the
// files of its frames spelled as on Windows, and none prints the folder. A pattern that cuts at either: /\(.*[\\/]/. One that finds a path: /^(?:[A-Z]:)?[\\/]/.
import { describe, expect, test } from "bun:test";
import { bunExe, isWindows } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  besideOf,
  find,
  inPrograms,
  isGroup,
  referenceEnv,
  slot,
  sourceOf,
  spawned,
  taken,
  told,
} from "./run-programs";

const spelling = join(import.meta.dir, "harness", "frames-spelled-as-on-windows.js");
const optionsOf = (path: string) =>
  existsSync(besideOf(path) + ".json") ? JSON.parse(readFileSync(besideOf(path) + ".json", "utf8")) : {};
// In a text, in a pattern, in a class of a pattern.
const looksForASlash = /["'`]\/["'`]|\\\/|\[[^\]\n]*\//;
// What a program says of its own folder is spelled as it is here, so a program that takes that text out of a frame does not find it.
const namesItsFolder = /\bimport\.meta\.dir(name)?\b|\b__dirname\b|\bprocess\.cwd\(\)/;

const chosen = taken(
  // A file directly in ./programs is a helper, not a program.
  find().filter(path => !isGroup(path) && /[\\/]/.test(inPrograms(path))),
  path => {
    const source = sourceOf(path);
    return /\.stack\b/.test(source) && looksForASlash.test(source) && !namesItsFolder.test(source);
  },
).filter(
  path =>
    !existsSync(besideOf(path) + ".todo.txt") &&
    !existsSync(besideOf(path) + ".build-errors.txt") &&
    // Such a program is compared with an executable, whose files lie where its own lie.
    optionsOf(path).reference !== "compiled",
);

describe.concurrent("with the files of frames spelled as on Windows no folder is printed", () => {
  for (const path of chosen) {
    test(
      inPrograms(besideOf(path)).replaceAll("\\", "/"),
      () =>
        slot(async () => {
          const folder = path.slice(0, -inPrograms(path).length);
          const { stdout, stderr } = told(
            await spawned([bunExe(), "run", "--preload", spelling, path], join(path, ".."), {
              ...referenceEnv,
              ...optionsOf(path).env,
            }),
          );
          const spelled = isWindows ? folder : "C:" + folder.replaceAll("/", "\\");
          expect((stdout + stderr).split("\n").filter(line => line.includes(spelled))).toEqual([]);
        }),
      600_000,
    );
  }
});
