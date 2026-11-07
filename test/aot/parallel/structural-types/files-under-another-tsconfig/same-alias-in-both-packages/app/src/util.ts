export const name = "the application's";
export function twice(text: string): string {
  return text + text;
}
export function make(): { text: string } {
  return { text: "app" };
}
