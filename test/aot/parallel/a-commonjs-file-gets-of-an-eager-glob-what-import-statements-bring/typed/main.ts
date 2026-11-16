// Reference: bun build --compile
type Page = { default: { a: number }; a: number };
const whole = import.meta.glob<Page>("./mods/*.cjs", { eager: true });
const byDefault = import.meta.glob<{ a: number }>("./mods/*.cjs", { eager: true, import: "default" });
for (const key of Object.keys(whole)) console.log(key, Object.keys(whole[key]).sort().join(), byDefault[key].a, whole[key].default === byDefault[key]);
module.exports = { made: 1 };
