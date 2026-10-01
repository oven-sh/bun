// usage: H=<tree>/test/cli/lint/conformance bun $H/sweep.ts --check <this file> --no-files [selector ...]
// A check for --check of sweep.ts that replays the oracle of its instance and then changes what it replays, by a rule of the name
// of the instance, so that a sweep shows every form of a result that is no pass: a diagnostic less, another text, another place,
// no lengths (the plain format), a length that is wrong, a diagnostic where the oracle has none, a stand-in, a refusal, a throw.
const home = process.env.H;
if (home === undefined) throw new Error("set H to the directory of sweep.ts");
const { replayCheck } = await import(`${home}/runner`);
const { readOracle } = await import(`${home}/runner/oracle`);

const replay = replayCheck((instance: { oracle?: unknown }) => readOracle(instance.oracle));

export default async function mutate(input: any, signal: AbortSignal) {
  const h = Bun.hash.crc32(input.instance.name);
  if (input.instance.oracle.class !== "E") {
    const kind = h % 8;
    if (kind === 0 && input.units.length > 0) {
      const unit = input.units[input.units.length - 1];
      const location = { file: unit.unitName, start: 0, length: Math.min(1, unit.content.length) };
      return { diagnostics: [{ category: "error", code: 9999, messageText: "Made up.", location, relatedInformation: [] }] };
    }
    if (kind === 1 && input.units.length > 0) {
      const unit = input.units[0];
      return { diagnostics: [{ category: "error", code: 9998, messageText: "Made up, plain.", location: { file: unit.unitName, line: 1, character: 1 } }] };
    }
    if (kind === 2) return { diagnostics: [{ category: "error", code: 9997, messageText: "Made up, no file.", relatedInformation: [] }] };
    return { diagnostics: [] };
  }
  const result = await replay(input, signal);
  const ds = result.diagnostics;
  switch (h % 12) {
    case 0:
      return result;
    case 1:
      return { diagnostics: ds.slice(0, -1) };
    case 2:
      return { diagnostics: ds.map((d: any, k: number) => (k === 0 ? { ...d, messageText: d.messageText + " Changed." } : d)) };
    case 3:
      return { diagnostics: ds.map((d: any) => ({ ...d, location: d.location && { ...d.location, start: undefined, length: undefined }, relatedInformation: undefined })) };
    case 4:
      return {
        diagnostics: ds.map((d: any, k: number) => ({
          ...d,
          messageText: k === ds.length - 1 ? d.messageText + " Changed." : d.messageText,
          location: d.location && { ...d.location, start: undefined, length: undefined },
          relatedInformation: undefined,
        })),
      };
    case 5:
      return { diagnostics: ds.map((d: any, k: number) => (k === ds.length - 1 && d.location?.length !== undefined ? { ...d, location: { ...d.location, length: d.location.length + 1 } } : d)) };
    case 6:
      return { diagnostics: ds, standIns: ["checker.getTypeOfExpression"] };
    case 7:
      return { diagnostics: [], unavailable: "the check takes one file\r\nand no more" };
    case 8:
      throw new Error("the command ended by the signal SIGSEGV\n  at a line below");
    case 9:
      return { diagnostics: [...ds, ...ds.slice(0, 1)] };
    case 10:
      return { diagnostics: ds.slice(1) };
    default:
      return { diagnostics: ds.slice().reverse() };
  }
}
