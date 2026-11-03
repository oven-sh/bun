export interface OpenType {
  family: "unknown-code" | "unproven-type" | "mutation";
  name: string;
  reason: string;
}

export const openTypesFlags = ["--explain=unknown-code", "--explain=unproven-type"];
export const mutatedTypesFlags = ["--explain=mutation"];

const openTypeLine = /^aot: (unknown-code|unproven-type|mutation): (.+?): ([a-z-]+) at (?:.+:\d+:\d+|\(no location\))(?:, [\d,]+ checked access(?:es)?)?$/;

export function parseOpenTypes(output: string): OpenType[] {
  return output.split("\n").flatMap(line => {
    const match = openTypeLine.exec(line);
    if (!match) return [];
    return { family: match[1] as OpenType["family"], name: match[2], reason: match[3] };
  });
}

export function uniqueNames(types: OpenType[]): string[] {
  return [...new Set(types.map(type => type.name))];
}
