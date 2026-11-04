// @ts-nocheck
export function Box() { return 7; }
namespace Box { export const t = 2; }
try { console.log(Box.t, Box()); } catch (e) { console.log(e.name); }
