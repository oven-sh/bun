export const act = lib => {
  const spy = jest.spyOn(lib, "total").mockReturnValue("spied");
  return () => spy.mockRestore();
};
