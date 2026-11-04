const name = ["spy", "On"].join("");
export const spyWith = lib => { const spy = Bun.jest(import.meta.path)[name](lib, "total").mockReturnValue("spied"); return () => spy.mockRestore(); };
