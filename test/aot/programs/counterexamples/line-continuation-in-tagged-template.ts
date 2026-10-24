// A backslash at the end of a line in a tagged template: the raw text has a line feed, the cooked text nothing.
declare const console: { log(...a: unknown[]): void };
const t = (s: TemplateStringsArray): string => JSON.stringify([s.raw[0], s[0]]);
console.log(t`a\
b`);
