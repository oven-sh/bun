export const spyWith = () => {
  Bun.jest(import.meta.path).mock.module("./lib.js", () => ({ total: () => "mocked", twice: x => x }));
};
