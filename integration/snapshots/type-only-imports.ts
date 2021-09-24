export const baconator = true;
export const SilentSymbolCollisionsAreOkayInTypeScript = true;
export function test() {
  console.assert(SilentSymbolCollisionsAreOkayInTypeScript);
  console.assert(baconator);
  return testDone(import.meta.url);
}
