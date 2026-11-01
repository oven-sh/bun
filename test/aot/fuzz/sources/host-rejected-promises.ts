// A list of programs from ../host-rejected-promises.ts, which describes them.
import {
  everyLook,
  files,
  generate,
  handlers,
  looks,
  looksThatShowTheMessage,
  nameOf,
  rejections,
} from "../host-rejected-promises";
import { family } from "../family";

export default family(
  "host rejected promises",
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
