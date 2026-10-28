// The programs of fuzz/promises-that-the-program-did-not-reject.ts. Every promise meets every handler that stands on the promise itself, with every look at once, and two of the
// other handlers, or all of them where only the loader rejects. then() and catch() also take one look alone, another for each promise, and each look alone where the loader
// refuses the options of an import.
import { isASAN } from "harness";
import {
  everyLook,
  files,
  generate,
  generateAtTheEndOfTheStack,
  generateInAFullHeap,
  handlers,
  looks,
  looksThatShowTheMessage,
  makers,
  nameOf,
  rejections,
  type Rejection,
} from "./fuzz/promises-that-the-program-did-not-reject";
import { generated } from "./generated/run-generated";

function departsToday({ promise }: Rejection, look: string) {
  const showsTheMessage = look === everyLook || looksThatShowTheMessage.includes(look);
  if (promise.startsWith('import("data:text/javascript,') && (look === everyLook || look === "stack"))
    return "the error of text that does not parse has no stack";
  if (promise.includes("value.member") && showsTheMessage) return "the message names the value and not the expression";
  if (promise === "WebAssembly.instantiate(5)" && showsTheMessage) return "the message does not name the call";
}

generated(
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
      const shown = alone.filter(look => !rejection.messageNamesAPath || !looksThatShowTheMessage.includes(look));
      return [everyLook, ...shown].map(look => ({
        name: nameOf(rejection, handler, look),
        isAlwaysRun:
          !!rejection.isOfTheLoaderAlone &&
          !!handler.standsOnThePromise &&
          (look === everyLook || (takesEachLook && look === "message")),
        wasOnceWrong:
          takesEachLook &&
          rejection.promise === 'import("./leaf.mjs", 5)' &&
          (look === everyLook || look === "message"),
        isOnlyCompiled: true as const,
        ...(departsToday(rejection, look) ? { linesDepartToday: departsToday(rejection, look) } : {}),
        make: () => ({
          file: handler.isTyped ? "main.ts" : "main.mjs",
          text: generate(rejection, handler, look),
          files,
        }),
      }));
    }),
  ),
);

generated(
  "a handler is handed a RangeError where a promise is made with hardly any room left",
  makers.flatMap(([name, needs, promise], index) =>
    (["then", "catch"] as const).flatMap(handler => [
      {
        name: `${name} | ${handler} | at the end of the stack`,
        isAlwaysRun: index % 2 === 0,
        isOnlyCompiled: true as const,
        make: () => ({ file: "main.mjs", text: generateAtTheEndOfTheStack(needs, promise, handler), files }),
      },
      {
        name: `${name} | ${handler} | in a full heap`,
        isAlwaysRun: index % 2 === 1,
        isOnlyCompiled: true as const,
        hangsOnCollections: true as const,
        mayStopOutOfMemory: true as const,
        alsoUnder: isASAN ? [] : [{ BUN_JSC_markedBlockCageSizeInMB: "64" }],
        make: () => ({ file: "main.mjs", text: generateInAFullHeap(needs, promise, handler), files }),
      },
    ]),
  ),
);
