// The programs of fuzz/promises-that-the-program-did-not-reject.ts. Every promise meets every handler that stands on the promise itself, with every look at once, and two of the
// other handlers, or all of them where only the loader rejects. then() and catch() also take one look alone, another for each promise, and each look alone where the loader
// refuses the options of an import.
import {
  everyLook,
  files,
  generate,
  handlers,
  looks,
  looksThatShowTheMessage,
  nameOf,
  rejections,
} from "../promises-that-the-program-did-not-reject";
import { family } from "../family";

export default family(
  "a handler is handed what plain Bun hands it where the program did not reject the promise",
  rejections.flatMap((rejection, rejectionIndex) =>
    handlers.flatMap((handler, handlerIndex) => {
      if (!handler.standsOnThePromise && !rejection.isOfTheLoaderAlone && (rejectionIndex + handlerIndex) % 3 !== 0)
        return [];
      if (rejection.beginsInItsOwnThen && handler.name === "then.call") return [];
      const isPlain = handler.name === "then" || handler.name === "catch";
      const takesEachLook = isPlain && rejection.promise.startsWith('import("./leaf.mjs", ');
      const alone = takesEachLook
        ? looks.map(([look]) => look)
        : isPlain
          ? [looks[(rejectionIndex + handlerIndex) % looks.length][0]]
          : [];
      const shown = alone.filter(look => !rejection.messageDiffers || !looksThatShowTheMessage.includes(look));
      return [everyLook, ...shown].map(look => ({
        name: nameOf(rejection, handler, look),
        make: () => ({
          file: handler.isTyped ? "main.ts" : "main.mjs",
          text: generate(rejection, handler, look),
          files,
        }),
      }));
    }),
  ),
);
