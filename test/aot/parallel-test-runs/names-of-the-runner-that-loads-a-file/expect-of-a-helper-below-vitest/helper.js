export const own = () => expect;
// The toContain() of Vitest makes a string of the number. The one of Jest throws.
export function rule() {
  try {
    expect("abc1").toContain(1);
    return "passes";
  } catch {
    return "throws";
  }
}
