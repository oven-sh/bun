// The raw strings of a tagged template contain non-ASCII characters as written in the source. Plain Bun rewrites these characters to escapes before it runs the file, so its raw strings contain the escapes.
export {};

const rawOf = (strings: TemplateStringsArray, ..._values: unknown[]): readonly string[] => strings.raw;

function codeUnitsOf(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) result += (i ? " " : "") + text.charCodeAt(i).toString(16);
  return result;
}

for (const raw of rawOf`é${1}日本語${2}😀${3}ÿĀ`) console.log(raw, codeUnitsOf(raw));
