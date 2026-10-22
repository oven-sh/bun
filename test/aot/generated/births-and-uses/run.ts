// Every birth of a kind of value against every use of it. A rule of the compiler about what a built-in makes, or about what a use may take for granted, is written for the births and uses
// that its author thought of: the pairs that nobody thought of are here. Each pair is a program of its own, so that nothing but that birth decides what the compiler believes at that use.
//
//   bun test test/aot/generated-births-and-uses                          one pair in forty, the same ones every time, and every pair that once showed a fault (once-wrong.json)
//   AOT_GENERATED=all bun test test/aot/generated-births-and-uses        every pair: 56,000 programs, and 54,000 more as TypeScript
//   AOT_GENERATED=template- bun test test/aot/generated-births-and-uses  the pairs whose name contains the text
import { join } from "path";
import { generated } from "../run-generated";
import known from "./known-to-differ.json";
import onceWrong from "./once-wrong.json";

const tsconfig = JSON.stringify({
  compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, typeRoots: [join(import.meta.dir, "..", "..", "..", "..", "packages")], types: ["bun-types"] },
});

export function birthsAndUses(title: string, programs: { name: string; file: string; text: string }[], part = 1, parts = 1) {
  const differs: Record<string, string> = (known as Record<string, Record<string, string>>)[title] ?? {};
  const wasWrong = new Set((onceWrong as Record<string, string[]>)[title]);
  generated(
    "births and uses of " + title,
    programs.filter(({ name }) => Number(BigInt(Bun.hash(name)) % BigInt(parts)) === part - 1).map(({ name, file, text }) => ({
      name,
      isAlwaysRun: wasWrong.has(name) || Number(BigInt(Bun.hash(title + "/" + name)) % 40n) === 0,
      isOnlyCompiled: true as const,
      // Some pairs are no program: a use that does not parse behind that birth, or that TypeScript rejects.
      mayBeUnjudgeable: true as const,
      failsToday: differs[name],
      make: () => ({ file, text, files: file.endsWith(".ts") ? { "tsconfig.json": tsconfig } : undefined }),
    })),
  );
}
