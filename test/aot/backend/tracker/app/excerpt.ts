import { escape } from "./views/layout";

export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(word => word !== "");
}

/** The first words of a text. */
export function summary(text: string, most: number): string {
  const words = wordsOf(text);
  return words.length <= most ? words.join(" ") : `${words.slice(0, most).join(" ")} ...`;
}

/** Some thirty words around the first one that begins with a term that was searched for, as HTML, with those words marked. */
export function markedExcerpt(text: string, terms: string[]): string {
  const words = wordsOf(text);
  const matches = (word: string) => {
    const lower = word.toLowerCase();
    return terms.some(term => lower.startsWith(term));
  };
  const first = Math.max(0, words.findIndex(matches));
  const from = Math.max(0, first - 8);
  const to = Math.min(words.length, from + 30);
  const shown = words.slice(from, to).map(word => (matches(word) ? `<mark>${escape(word)}</mark>` : escape(word)));
  return `${from > 0 ? "... " : ""}${shown.join(" ")}${to < words.length ? " ..." : ""}`;
}
