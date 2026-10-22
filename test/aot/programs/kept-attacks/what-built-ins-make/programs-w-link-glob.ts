// What built ins make: programs w link glob. It prints what plain Bun prints.
// @ts-nocheck
const holder = new Bun.Glob("*");
const prototype = Object.getPrototypeOf(holder);
const behind = Object.getPrototypeOf(prototype);
try { Object.setPrototypeOf(prototype, Object.create(behind, { extra: { value: "from behind", configurable: true } })); console.log(holder.extra); } catch (e) { console.log(e.name, e.message.slice(0, 70)); }
