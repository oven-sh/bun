/**
 * Says why a trimmed executable keeps something: `bun scripts/build/trim/why.ts <retained.txt> <regular expression>`.
 *
 * The trimmable link writes retained.txt into its work folder (`<executable>.trim-work`): one line for each section that
 * no feature takes along. For the sections whose names match, this prints how many bytes there are, and for each place
 * where a section that does not match first reaches them: the bytes behind it and the shortest way to it from a root.
 */
import { readFileSync } from "node:fs";

export interface RetainedSection {
  previous: number;
  size: number;
  output: string;
  name: string;
}

export interface Holder {
  bytes: number;
  sections: number;
  /** The first matching section, then what reaches it, up to a root. */
  way: string[];
}

export function parseRetained(text: string): Map<number, RetainedSection> {
  const sections = new Map<number, RetainedSection>();
  for (const line of text.split("\n")) {
    const [node, previous, , size, output, ...name] = line.split(" ");
    if (output === undefined) continue;
    sections.set(Number(node), { previous: Number(previous), size: Number(size), output, name: name.join(" ") });
  }
  return sections;
}

export function findHolders(sections: ReadonlyMap<number, RetainedSection>, pattern: RegExp): Holder[] {
  const holders = new Map<number, Holder>();
  for (const [node, section] of sections) {
    if (!pattern.test(section.name)) continue;
    let first = node;
    for (;;) {
      const { previous } = sections.get(first)!;
      const above = sections.get(previous);
      if (above === undefined || !pattern.test(above.name)) break;
      first = previous;
    }
    let holder = holders.get(first);
    if (holder === undefined) {
      const way: string[] = [];
      for (let at = first; sections.has(at); at = sections.get(at)!.previous) {
        const { name, output } = sections.get(at)!;
        way.push(name === "" ? `a section of ${output} without a name` : name);
      }
      holders.set(first, (holder = { bytes: 0, sections: 0, way }));
    }
    holder.bytes += section.size;
    holder.sections++;
  }
  return [...holders.values()].sort((a, b) => b.bytes - a.bytes || (a.way[0]! < b.way[0]! ? -1 : 1));
}

if (import.meta.main) {
  const [path, pattern, most = "10"] = process.argv.slice(2);
  if (path === undefined || pattern === undefined) {
    console.error("usage: bun scripts/build/trim/why.ts <retained.txt> <regular expression> [ways to print = 10]");
    process.exit(1);
  }
  const holders = findHolders(parseRetained(readFileSync(path, "utf8")), new RegExp(pattern));
  console.log(`${holders.reduce((sum, holder) => sum + holder.bytes, 0)} bytes that no feature takes along match`);
  for (const { bytes, sections, way } of holders.slice(0, Number(most))) {
    console.log(`${bytes} bytes in ${sections} sections behind ${way[0]}`);
    for (const name of way.slice(1)) console.log(`    <- ${name}`);
  }
}
