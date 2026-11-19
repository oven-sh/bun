import type { Written } from "./code-block-placement";

/** Adds, beside each TypeScript program, the same text built with types erased. */
export const alsoWithTypesErased = (programs: Written[], isTyped: boolean | undefined): Written[] =>
  !isTyped
    ? programs
    : programs.flatMap(program => [
        program,
        { name: program.name + "-types-erased", file: program.file, flags: ["--aot-erase-types"], get text() { return program.text; } },
      ]);
