interface Settings { level: number; extra: number }
const made = Object.create({ extra: 100 });
Object.defineProperty(made, "level", { get: () => 5, enumerable: true });
export const settings = made as Settings;
export function copyOf(): Settings { return { ...settings }; }
