// A program in one file that another generator of this folder writes, laid into several files so that one wanted thing is true of the files: some are JavaScript that nothing declares, or JavaScript beside
// declaration files that say too little, or beside declaration files that are not valid either (under skipLibCheck), or the first file imports through a barrel, or some files are packages in node_modules, or a file
// in TypeScript says too little in its own annotations (under @ts-nocheck). sources.ts laidIntoFiles() lays the files and notes what it did; this draws until the note says what is wanted.
import { Random } from "./random";
import { laidIntoFiles } from "./sources";

/** What is wanted of the files, and how the note of laidIntoFiles() says it. */
export const ways = {
  "JavaScript that nothing declares": /in JavaScript(?!, \d+ of them beside)/,
  "JavaScript beside declarations that say too little": /say too little(?! and are not valid)(?!, under @ts-nocheck)/,
  "JavaScript beside declarations that are not valid": /are not valid, under skipLibCheck/,
  "a barrel": /one a barrel/,
  "packages": /as packages/,
  "TypeScript whose own annotations say too little": /under @ts-nocheck/,
} as const;

export type Way = keyof typeof ways;

/** The first program out of forty of the generator that can be laid out in the wanted way. Where none can, the last one as it is. */
export function laidOut(
  generate: (random: Random, isTyped: boolean) => string | { text: string },
  way: Way,
  random: Random,
): { file: string; text: string; files: Record<string, string>; isAsWanted: boolean } {
  let text = "";
  for (let turn = 0; turn < 40; turn++) {
    const seed = random.next();
    const whole = generate(new Random(seed), true);
    text = typeof whole === "string" ? whole : whole.text;
    const laid = laidIntoFiles(text, "ts", new Random(seed));
    if (laid && ways[way].test(laid.notes))
      return { file: "main.ts", text: laid.text, files: laid.files, isAsWanted: true };
  }
  return { file: "main.ts", text, files: {}, isAsWanted: false };
}
