export const load = () => ["import(\"./dep.mjs\")"].map(eval)[0];
