export const isDocumentationFile = (filename: string) =>
  /^(\.vscode|\.github|bench|docs|examples)|\.(md)$/i.test(filename);
export const isTestFile = (filename: string) => /^test/i.test(filename) || /runner\.node\.mjs$/i.test(filename);
