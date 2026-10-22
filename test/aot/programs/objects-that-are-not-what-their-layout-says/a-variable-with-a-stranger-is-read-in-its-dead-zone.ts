interface Settings { level: number }
function early(): number { return settings.level; }
try { console.log(early()); } catch (error) { console.log((error as Error).name); }
const settings = Object.create({ level: 4 }) as Settings;
const literal: Settings = { level: 5 };
console.log(early(), literal.level);
