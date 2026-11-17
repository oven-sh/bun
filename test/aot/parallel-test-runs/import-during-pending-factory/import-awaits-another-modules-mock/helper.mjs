export const slow = async () => {
  globalThis.began();
  await globalThis.gate;
  return { width: "mock" };
};
