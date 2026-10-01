// usage: bun crashes-md.ts <report.json of sweep.ts> > CRASHES.md
const r = JSON.parse(await Bun.file(process.argv[2]).text());
const out: string[] = [`# Crashes and hangs of \`bun --lint\` on the corpus`, ``, `Check: \`${r.check}\`. Swept ${r.totals.run} instances in ${r.seconds} s.`, `Crashes: ${r.crashes.length} (the command died in ${r.totals.deaths}). Timeouts: ${r.timeouts.length}.`, ``];
const fence = "```";
for (const [title, list] of [["Crashes", r.crashes], ["Hangs", r.timeouts]] as const) {
  out.push(`## ${title}`, ``);
  if (list.length === 0) out.push(`None.`, ``);
  for (const c of list) {
    out.push(`### ${c.name} (class ${c.kind})`, ``, `- case: \`corpus/cases/${c.casePath}\``, `- operands: ${(c.operands ?? []).map((o: string) => `\`${o}\``).join(" ")} in \`${c.currentDirectory}\``, `- ${c.reason}`);
    if (c.death !== undefined) out.push(`- exit code ${c.death.exitCode}, signal ${c.death.signal}`, ``, fence, c.death.stderr.trimEnd(), fence);
    out.push(`- again: \`bun test/cli/lint/conformance/sweep.ts --bin <binary> --jobs 1 --timeout 600000 ${JSON.stringify(c.name)}\``, ``);
  }
}
console.log(out.join("\n"));
