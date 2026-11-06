// A build knows every module that its program can load, and what it knows about the program rests on that. A program that takes a member of the global object in a way that the build does not
// follow could come by a loader and load anything: its world is open, more of the library is built into the executable, and entry points that are built together with it are one program
// with it and no longer a program each. `withTheWorldOpen` ends a text with such a read. The program prints what it printed before.
const line = 'void Reflect.get(globalThis, "process");';

export function withTheWorldOpen(text: string): string {
  return text.includes(line) ? text : `${text}\n${line}\n`;
}

// `globalThis`, `process`, `Bun` or `require` as a value: an argument, an element, or read under a key that is computed.
const leaves =
  /(?<![.\w$"'`])(?:globalThis|process|Bun|require)\b(?!\s*(?:\??\.\s*[\w$]|\[\s*["'`]|\(\s*["'`]|:| as any\)[.[]))/;

/** Whether a text is written in one of the ways that open the world. The build has the say: this only sorts programs. */
export function opensTheWorld(text: string): boolean {
  return leaves.test(text) || /(?<![.\w$])eval\(|\bFunction\(|\bimport\((?!["'`)])/.test(text);
}
