import type { IcuLanguage } from "./types.ts";

const localeBundleStem = /^[a-z]{2,3}(_[A-Za-z0-9]+)*$/;

export function languageOfIcuItem(name: string): string | undefined {
  const file = name.slice(name.indexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  if (dot < 0 || file.slice(dot + 1) !== "res") return undefined;
  const stem = file.slice(0, dot);
  if (stem === "res_index" || !localeBundleStem.test(stem)) return undefined;
  const underscore = stem.indexOf("_");
  return underscore < 0 ? stem : stem.slice(0, underscore);
}

/** The disjoint sets that the pairs make: each set sorted, and the sets in the order of their first language. */
export function joinLanguages(pairs: Iterable<readonly [string, string]>): string[][] {
  const setOf = new Map<string, Set<string>>();
  for (const [one, other] of pairs) {
    const joined = setOf.get(one) ?? new Set([one]);
    for (const language of setOf.get(other) ?? [other]) setOf.set(language, joined.add(language));
    setOf.set(one, joined);
  }
  return [...new Set(setOf.values())].map(set => [...set].sort()).sort(([a], [b]) => (a! < b! ? -1 : 1));
}

export function groupLanguages(languages: Iterable<string>, groups: readonly string[][]): IcuLanguage[] {
  const lineOfLanguage = new Map<string, number>();
  groups.forEach((line, index) => {
    for (const language of line) lineOfLanguage.set(language, index);
  });
  const groupOfLine: (number | undefined)[] = groups.map(() => undefined);
  let groupCount = 0;
  return [...new Set([...languages, ...lineOfLanguage.keys()])].sort().map(name => {
    const line = lineOfLanguage.get(name);
    const group = (line === undefined ? undefined : groupOfLine[line]) ?? groupCount++;
    if (line !== undefined) groupOfLine[line] = group;
    return { name, group };
  });
}
