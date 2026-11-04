const runner = Bun.jest(import.meta.path);
export const spyWith = lib => { const spy = runner.spyOn(lib, "total").mockReturnValue("spied"); return () => spy.mockRestore(); };
