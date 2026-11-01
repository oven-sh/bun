export const honest = () => [{ id: 1, name: "a", tags: ["x"] }, { id: 2, name: "b", tags: [] }, { id: 3, name: "c", tags: ["y", "z"] }];
export const odd = {
  textIds: () => [{ id: "1", name: "a" }, { id: "2", name: "b" }],
  mixedIds: () => [{ id: 1 }, { id: "2" }, { id: null }, { id: 4n }],
  missingIds: () => [{ name: "a" }, {}, { id: 3 }],
  holes: () => [{ id: 1 }, , { id: 3 }],
  primitives: () => [1, "two", null],
  aText: () => "abc",
  anArrayLike: () => ({ 0: { id: 1 }, length: 1 }),
  aSet: () => new Set([{ id: 1 }]),
  empty: () => [],
  getters: () => [{ get id() { return 5; } }, Object.create({ id: 6 })],
};
