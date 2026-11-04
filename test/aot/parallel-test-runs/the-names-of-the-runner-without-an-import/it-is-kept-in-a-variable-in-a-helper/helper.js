const kept = vi;
export const act = lib => {
  const spy = kept.spyOn(lib, "total").mockReturnValue("spied");
  return () => spy.mockRestore();
};
