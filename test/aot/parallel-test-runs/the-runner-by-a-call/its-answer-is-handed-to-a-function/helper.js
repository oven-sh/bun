const take = runner => runner;
const runner = take(Bun.jest(import.meta.path));
export const spyWith = lib => { const spy = runner.spyOn(lib, "total").mockReturnValue("spied"); return () => spy.mockRestore(); };
