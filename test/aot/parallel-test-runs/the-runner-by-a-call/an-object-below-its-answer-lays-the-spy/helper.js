export const spyWith = lib => { const spy = Bun.jest(import.meta.path).jest.spyOn(lib, "total").mockReturnValue("spied"); return () => spy.mockRestore(); };
