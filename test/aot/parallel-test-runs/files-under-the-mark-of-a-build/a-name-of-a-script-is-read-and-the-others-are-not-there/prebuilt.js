// @bun
export function tries() {
  const ends = [];
  for (const call of [() => jest.mine, () => expect(1), () => vi.fn(), () => describe("inner", () => {}), () => typeof it]) {
    try {
      ends.push(String(call()));
    } catch (error) {
      ends.push(error.name + ": " + error.message);
    }
  }
  return ends.join(" | ");
}
