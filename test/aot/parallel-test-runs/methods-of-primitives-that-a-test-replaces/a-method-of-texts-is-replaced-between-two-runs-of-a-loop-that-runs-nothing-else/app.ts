export function breaks(text: string, from: number): number {
  let found = 0;
  for (let at = from; at < text.length; at++) if (text.charCodeAt(at) === 10) found++;
  return found;
}
function widthOfBreak(text: string, at: number): number {
  const code = text.charCodeAt(at);
  if (code === 10) return 1;
  if (code === 13) return at + 1 < text.length && text.charCodeAt(at + 1) === 10 ? 2 : 1;
  return 0;
}
export function lines(text: string): number {
  let at = 0, found = 0;
  while (at < text.length) {
    const width = widthOfBreak(text, at);
    if (!width) {
      at++;
      continue;
    }
    found++;
    at += width;
  }
  return found;
}
