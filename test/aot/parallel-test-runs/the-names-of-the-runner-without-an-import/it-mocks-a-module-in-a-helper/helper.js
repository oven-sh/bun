export const act = () => {
  vi.doMock("./late.js", () => ({ late: "mock" }));
  return async () => console.log("late", (await import("./late.js")).late);
};
