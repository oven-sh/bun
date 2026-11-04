function changed(...values: string[]): string;
function changed(): string {
  const seen: string[] = [];
  for (const value of arguments) {
    arguments[2] = "Z";
    seen.push(value as string);
  }
  return seen.join();
}
function cut(...values: string[]): string;
function cut(): string {
  const seen: string[] = [];
  for (const value of arguments) {
    arguments.length = 1;
    seen.push(value as string);
  }
  return seen.join();
}
function underACast(...values: string[]): string;
function underACast(): string {
  const seen: string[] = [];
  const all = arguments as unknown as string[];
  for (const value of arguments) {
    all[2] = "Z";
    seen.push(value as string);
  }
  return seen.join();
}
console.log(changed("a", "b", "c"));
console.log(cut("a", "b", "c"));
console.log(underACast("a", "b", "c"));
