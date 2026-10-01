// A check that replays the oracle and then changes it by the name of the instance: one diagnostic fewer, a longer span, another message, a diagnostic more, or the plain format (no lengths).
const runner = process.env.RUNNER;
if (runner === undefined) throw new Error("RUNNER is not set");
const { replayCheck } = await import(`${runner}/index.ts`);
const { readOracle } = await import(`${runner}/oracle.ts`);
const replay = replayCheck((instance: { oracle: unknown }) => readOracle(instance.oracle));
export default async (input: any, signal: AbortSignal) => {
  const result = await replay(input, signal);
  const d = result.diagnostics;
  const kind = Bun.hash.crc32(input.instance.name) % 6;
  if (input.instance.oracle.class === "C") {
    if (kind === 0) return { diagnostics: [{ category: "error", code: 2322, messageText: "Made up.", location: { file: input.units[0]?.unitName ?? "/.src/x.ts", line: 1, character: 1 } }] };
    return result;
  }
  if (kind === 0) d.pop();
  else if (kind === 1) { const at = d.find((x: any) => x.location?.length !== undefined); if (at) at.location.length += 1; }
  else if (kind === 2) d[d.length - 1].messageText += "!";
  else if (kind === 3) d.push({ category: "error", code: 99999, messageText: "One more.", relatedInformation: [] });
  else if (kind === 4) for (const x of d) { if (x.location) { delete x.location.start; delete x.location.length; } x.relatedInformation = undefined; }
  return result;
};
