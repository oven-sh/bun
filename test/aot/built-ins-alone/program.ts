import type { WrittenProgram } from "../generate";

export interface Program {
  name: string;
  rows: string[];
  text: string;
  extension?: string;
}

export function asWritten(program: Program): WrittenProgram {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(program.name)) throw new Error(`${program.name} is not a file name in plain words`);
  const entry = `${program.name}.${program.extension ?? "js"}`;
  return { entry, files: { [entry]: program.text.endsWith("\n") ? program.text : `${program.text}\n` } };
}

export function lines(...parts: (string | false | null | undefined | readonly string[])[]): string {
  return parts
    .flat()
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

export const ordinals = ["first", "second", "third", "fourth", "fifth"] as const;
