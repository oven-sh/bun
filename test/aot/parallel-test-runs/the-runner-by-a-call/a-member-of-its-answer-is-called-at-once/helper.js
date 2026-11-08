export const spyWith = lib => { const spy = Bun.jest(import.meta.path).spyOn(lib, "total").mockReturnValue("spied"); return () => spy.mockRestore(); };
