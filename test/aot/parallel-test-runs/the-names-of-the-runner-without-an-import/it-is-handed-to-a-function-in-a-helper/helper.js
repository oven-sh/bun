const take = runner => runner;
const runner = take(jest);
export const act = lib => {
  const spy = runner.spyOn(lib, "total").mockReturnValue("spied");
  return () => spy.mockRestore();
};
