// Every birth of a kind of value against every use of it. A rule of the compiler about what a built-in makes, or about what a use may take for granted, is written for the births and uses
// that its author thought of: the pairs that nobody thought of are here. Each pair is a program of its own, so that nothing but that birth decides what the compiler believes at that use.
//
//   bun test test/aot/generated-births-and-uses                          one pair in 160, others for each commit of Bun, and every pair that once showed a fault (once-wrong.json)
//   AOT_SHARE=all bun test test/aot/generated-births-and-uses            one pair in forty, the same ones every time, and those
//   AOT_GENERATED=all bun test test/aot/generated-births-and-uses        every pair: 56,000 programs, and 54,000 more as TypeScript
//   AOT_GENERATED=template- bun test test/aot/generated-births-and-uses  the pairs whose name contains the text
import { join } from "path";
import { inShareOfList } from "../../run-programs";
import { generated } from "../run-generated";
import known from "./known-to-differ.json";
import onceWrong from "./once-wrong.json";

export const tsconfig = JSON.stringify({
  compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, typeRoots: [join(import.meta.dir, "..", "..", "..", "..", "packages")], types: ["bun-types"] },
});

/** The pairs are what `programs` of ./<from>.ts returns. */
export function birthsAndUses(title: string, from: string, isTyped?: boolean, part = 1, parts = 1) {
  const generator: { programs(isTyped?: boolean): { name: string; file: string; text: string; flags?: string[] }[]; oneIn?: number; alsoUnder?: Record<string, string>[] } = require(`./${from}`);
  const programs = generator.programs(isTyped);
  const differs: Record<string, string> = (known as Record<string, Record<string, string>>)[title] ?? {};
  const wasWrong = new Set((onceWrong as Record<string, string[]>)[title]);
  generated(
    "births and uses of " + title,
    programs.filter(({ name }) => Number(BigInt(Bun.hash(name)) % BigInt(parts)) === part - 1).map(program => ({
      name: program.name,
      // A generator of very many programs says how few of them every run takes.
      isAlwaysRun: inShareOfList(`${title}/${program.name}`, Number(BigInt(Bun.hash(title + "/" + program.name)) % BigInt(generator.oneIn ?? 40)), generator.oneIn ?? 40),
      wasOnceWrong: wasWrong.has(program.name),
      isOnlyCompiled: true as const,
      // Some pairs are no program: a use that does not parse behind that birth, or that TypeScript rejects.
      mayBeUnjudgeable: true as const,
      failsToday: differs[program.name],
      flags: program.flags,
      alsoUnder: generator.alsoUnder,
      // And makes the text of a program when it is asked for.
      make: () => ({ file: program.file, text: program.text, files: program.file.endsWith(".ts") ? { "tsconfig.json": tsconfig } : undefined }),
    })),
  );
}
