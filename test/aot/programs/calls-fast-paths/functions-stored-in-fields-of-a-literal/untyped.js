export function createScanner(text) {
  let position = 0, token = 0;
  const scanner = { getPosition: () => position, getToken: () => token, scan, isDone: () => position >= text.length };
  return scanner;
  function scan() { token = text.charCodeAt(position++); return token; }
}
