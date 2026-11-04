const kept = [vi];
export const act = lib => {
  const spy = kept[0].spyOn(lib, "total").mockReturnValue("spied");
  return () => spy.mockRestore();
};
