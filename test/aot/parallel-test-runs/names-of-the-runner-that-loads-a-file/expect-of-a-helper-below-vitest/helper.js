export const own = () => expect;
const outcome = check => {
  try {
    check();
    return "passes";
  } catch {
    return "fails";
  }
};
export const rules = () =>
  [
    outcome(() => expect("a1").toContain(1)),
    outcome(() => expect(1).not.not.toBe(2)),
    outcome(() => expect([1]).toEqual([1, undefined])),
  ].join(" ");
