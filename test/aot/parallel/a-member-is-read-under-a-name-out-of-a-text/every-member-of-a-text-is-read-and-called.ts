const names: any[] = JSON.parse(
  '["at","charAt","charCodeAt","codePointAt","concat","endsWith","includes","indexOf","isWellFormed","lastIndexOf","localeCompare","normalize","padEnd","padStart","repeat","replace","replaceAll","slice","split","startsWith","substring","toLowerCase","toUpperCase","toLocaleUpperCase","trim","toString","valueOf","length","0","7","absent","hasOwnProperty"]',
);
const operands: Record<string, unknown[]> = {
  at: [1],
  charAt: [1],
  charCodeAt: [1],
  codePointAt: [1],
  concat: ["!"],
  endsWith: ["t"],
  includes: ["ex"],
  indexOf: ["x"],
  lastIndexOf: ["t"],
  localeCompare: ["text"],
  padEnd: [6, "."],
  padStart: [6, "."],
  repeat: [2],
  replace: ["t", "T"],
  replaceAll: ["t", "T"],
  slice: [1],
  split: ["e"],
  startsWith: ["te"],
  substring: [1, 3],
  hasOwnProperty: ["length"],
};
for (const name of names) {
  const text = "text";
  const found = (text as any)[name];
  console.log(
    name,
    typeof found,
    typeof found === "function" ? String(found.apply(text, operands[name] ?? [])) : String(found),
  );
}
