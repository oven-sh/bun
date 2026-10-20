import fs from "node:fs";
import path from "node:path";

/** A set of files that is held in memory until the end of a run: name -> text. */
export type Files = Map<string, string>;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Replacement = string | ((...match: any[]) => string);

/** Replaces every match and says how many there were. */
export function replaceAndCount(text: string, pattern: RegExp, replacement: Replacement): [string, number] {
  if (!pattern.global) throw new Error(`${pattern} needs the g flag`);
  let count = 0;
  const result = text.replace(pattern, (...match) => {
    count++;
    if (typeof replacement === "function") return replacement(...match);
    return expand(replacement, match);
  });
  return [result, count];
}

/** Replaces the one match there has to be. */
export function replaceOnce(text: string, pattern: RegExp, replacement: Replacement, what: string): string {
  const [result, count] = replaceAndCount(text, new RegExp(pattern.source, withFlag(pattern.flags, "g")), replacement);
  if (count !== 1) throw new Error(`${what}: expected one match, found ${count}`);
  return result;
}

function withFlag(flags: string, flag: string): string {
  return flags.includes(flag) ? flags : flags + flag;
}

// `$1` ... `$9` in a replacement string, for a match as String.prototype.replace hands it to a function.
function expand(replacement: string, match: any[]): string {
  return replacement.replace(/\$(\d)/g, (_, digit) => match[Number(digit)] ?? "");
}

/** The named groups of a match as String.prototype.replace hands it to a function. */
export function groupsOf(match: any[]): Record<string, string> {
  return match[match.length - 1];
}

/** `#include <WebCore/X.h>` is for a framework build. Every directory of Bun's copy is on the include path. */
export function useQuotedIncludes(text: string): string {
  return text.replace(/#(\s*)include <WebCore\/([^>]+)>/g, '#$1include "$2"');
}

/** Takes out the `#include "X.h"` lines of headers that Bun does not have. */
export function dropUnknownIncludes(text: string, knownHeaders: Set<string>): string {
  return text.replace(/^#include "([^"\n]+)"\n/gm, (line, header) => (knownHeaders.has(header) ? line : ""));
}

/** The names of all headers under a directory, without their directories. */
export function headersUnder(root: string, except?: string): string[] {
  const names: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (full !== except) names.push(...headersUnder(full, except));
    } else if (entry.name.endsWith(".h")) names.push(entry.name);
  }
  return names;
}

export function sorted<T>(values: Iterable<T>): T[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
