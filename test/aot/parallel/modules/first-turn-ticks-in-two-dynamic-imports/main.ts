// Two modules that `import()` loads import the same builtin modules, a third one more: each turn has the order of plain Bun, and a second `import()` of a module changes nothing.
const lines: string[] = [];
for (const load of [() => import("./first.ts"), () => import("./second.ts"), () => import("./third.ts"), () => import("./first.ts")]) {
  lines.push((await (await load()).order).join(", "));
}
console.log(lines.join("\n"));
export {};
