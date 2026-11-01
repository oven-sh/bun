export function whoCalls(this: unknown): string {
  return typeof this
}
export const arrow = () => 'arrow'
