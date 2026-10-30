// fuzz/texts-parsed-by-types-that-list-fewer-members.ts: `JSON.parse(text) as T` on texts with members that T does not list: in front of, between and behind the listed ones, under odd names,
// twice, with escapes and white space, beside values that are not as T says, in texts that are no JSON, by the hundred, and with other values under the same names. Every text is parsed several times. The results are listed, copied,
// written again, asked by name, changed and frozen; or only their listed members are read; alone, in lists, inside other parsed objects and through a reviver; or given other members and written again in every way of JSON.stringify.
// The executable prints what plain Bun prints. Every type meets every group of texts in every use.
import { generate, groupNames, typeNames, uses } from "../texts-parsed-by-types-that-list-fewer-members";
import { family } from "../family";

const programs = typeNames.flatMap(type => groupNames.flatMap(group => uses.map(use => ({ type, group, use }))));

export default family(
  "texts parsed by types that list fewer members",
  programs.map(({ type, group, use }, index) => ({
    name: `seed ${index + 1}, ${type}, members ${group}, ${use}.`,
    make: () => generate(type, group, use),
  })),
);
