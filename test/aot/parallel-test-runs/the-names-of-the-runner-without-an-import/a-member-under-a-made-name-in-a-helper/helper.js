const name = ["spy", "On"].join("");
export const act = lib => {
  const spy = vi[name](lib, "total").mockReturnValue("spied");
  return () => spy.mockRestore();
};
