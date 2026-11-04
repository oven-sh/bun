const spyOn = vi.spyOn;
export const act = lib => {
  const spy = spyOn(lib, "total").mockReturnValue("spied");
  return () => spy.mockRestore();
};
