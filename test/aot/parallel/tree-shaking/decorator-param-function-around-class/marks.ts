export const seen: string[] = [];
export function mark(label: string) {
  return (target: object, key: string | symbol | undefined, index: number): void => {
    seen.push(`${label} at parameter ${index} of ${String(key)}`);
  };
}
