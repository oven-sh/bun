// A build knows every module its program can load, and much of its analysis relies on that. A program that reads a
// member of the global object in an untracked way could obtain a loader and load anything. `opensTheWorld` detects such
// programs; the transform adds such an access.
const line = 'void Reflect.get(globalThis, "process");';

export function withTheWorldOpen(text: string): string {
  return text.includes(line) ? text : `${text}\n${line}\n`;
}

// `globalThis`, `process`, `Bun` or `require` as a value: an argument, an element, or read with a computed key.
const leaves =
  /(?<![.\w$"'`])(?:globalThis|process|Bun|require)\b(?!\s*(?:\??\.\s*[\w$]|\[\s*["'`]|\(\s*["'`]|:| as any\)[.[]))/;

/** Whether a text is written in one of the ways that open the world. The build has the say: this only sorts programs. */
export function opensTheWorld(text: string): boolean {
  return leaves.test(text) || /(?<![.\w$])eval\(|\bFunction\(|\bimport\((?!["'`)])/.test(text);
}
