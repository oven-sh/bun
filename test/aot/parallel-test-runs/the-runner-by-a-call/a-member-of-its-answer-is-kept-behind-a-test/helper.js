const spyOn = Bun.jest(import.meta.path).spyOn || null;
export const spyWith = lib => { const spy = spyOn(lib, "total").mockReturnValue("spied"); return () => spy.mockRestore(); };
