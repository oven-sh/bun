export const LIMIT = 3;
export const COUNT = 2;
export const HEAD = `"use strict";\nconst limit = ${LIMIT};\n`;
export const FIRST = "function first(x) {\n  let sum = 0;\n  for (let i = 0; i < 3; i++) sum += x * i;\n  return sum;\n}\n";
export const KEPT = "function kept(text) { return text + '!'; }\n";
