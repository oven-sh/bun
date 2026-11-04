const { spyOn } = Bun.jest(import.meta.path);
export const spyWith = lib => { const spy = spyOn(lib, "total").mockReturnValue("spied"); return () => spy.mockRestore(); };
