export const act = () => async () => {
  await import("./counted.js");
  vi.resetModules();
  await import("./counted.js");
};
