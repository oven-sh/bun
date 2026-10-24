// What Error.prepareStackTrace's call sites say of sloppy and strict functions: isToplevel() and isNative(), and that a strict frame makes every frame below it answer as a strict one.
import { rows } from "./sloppy.cjs";
for (const [name, row] of Object.entries(rows as Record<string, () => unknown>)) {
  try {
    console.log(name + ": " + (await row()));
  } catch (error) {
    console.log(name + ": " + (error as Error).constructor.name);
  }
}
