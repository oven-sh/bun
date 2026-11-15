"use strict";
const whole = import.meta.glob("./mods/*.cjs", { eager: true });
const byDefault = import.meta.glob("./mods/*.cjs", { eager: true, import: "default" });
for (const key of Object.keys(whole)) console.log(key, Object.keys(whole[key]).sort().join(), byDefault[key].a, whole[key].default === byDefault[key]);
