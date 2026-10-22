export interface Program {
  name: string;
  rows: string[];
  text: string;
  extension?: string;
}

export function lines(...parts: (string | false | null | undefined | readonly string[])[]): string {
  return parts
    .flat()
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

export const ordinals = ["first", "second", "third", "fourth", "fifth"] as const;
