import { besides, filesOf, importers, names, stores } from "./generated/names-stored-on-the-exports-of-a-commonjs-file";
import { generated } from "./generated/run-generated";

generated(
  "a name is stored on the exports of a CommonJS file somewhere in its text, and another file takes it",
  Object.keys(stores).flatMap(store =>
    [true, false].flatMap(hasFlag =>
      names.flatMap(name =>
        besides.flatMap(beside =>
          Object.keys(importers)
            // No Bun finds a getter under that name, and each words the error in its own way.
            .filter(
              importer =>
                !(name === "constructor" && store === "defined as a getter" && importer.includes("the name handed on")),
            )
            .map(importer => {
              const {
                "main.mjs": module,
                "main.cjs": script,
                ...files
              } = filesOf(store, hasFlag, name, beside, importer);
              return {
                name: `${name} ${store}, ${hasFlag ? "with" : "without"} the flag${beside ? ", beside a definition under a key nobody knows" : ""}; ${importer}`,
                isAlwaysRun:
                  !beside && (importer === "a star" || importer.startsWith("the default of a getter over the name")),
                isOnlyCompiled: true as const,
                keepsItsText: true as const,
                // TODO: the default import is undefined.
                failsToday:
                  name === "default" &&
                  hasFlag &&
                  !beside &&
                  importer === "the default of a getter over the name handed on" &&
                  /^(under an if|an arm of a conditional|behind \|\||in a function|in a try)$/.test(store)
                    ? "the default import is undefined"
                    : undefined,
                make: () => ({ file: module ? "main.mjs" : "main.cjs", text: module ?? script, files }),
              };
            }),
        ),
      ),
    ),
  ),
);
