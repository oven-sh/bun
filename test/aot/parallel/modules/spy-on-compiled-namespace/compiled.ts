export let f: () => string = () => "first";
export let count: number = 0;

export function replace(next: () => string): void {
  f = next;
  count++;
}
