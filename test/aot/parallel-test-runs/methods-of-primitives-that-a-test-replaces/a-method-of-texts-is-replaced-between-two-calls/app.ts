export function tail(text: string): string {
  return text.slice(1);
}
export function both(text: string, between: () => void): string {
  const first = text.slice(1);
  between();
  return first + "|" + text.slice(1);
}
