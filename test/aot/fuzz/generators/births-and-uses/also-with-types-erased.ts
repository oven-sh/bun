import type { Written } from "./where-a-stretch-stands";

/** Beside each program in TypeScript, the same text built as if it had no types. */
export const alsoWithTypesErased = (programs: Written[], isTyped: boolean | undefined): Written[] =>
  !isTyped
    ? programs
    : programs.flatMap(program => [
        program,
        { name: program.name + "-types-erased", file: program.file, flags: ["--aot-erase-types"], get text() { return program.text; } },
      ]);
