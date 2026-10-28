// Several points of the table in ../generated/object-mutations.ts on one object: two to four changes, of the object itself and of what stands above it, one behind the other in a drawn order, and two looks at what is left.
import { axesOf, nameOf, pickCombination, textOf, type Combination } from "../generated/object-mutations";
import type { Random } from "./random";

type Operation = Combination["operation"];
type Look = Combination["look"];
type Site = Parameters<Operation["text"]>[0];

const subjectOf = (site: Site, target: Combination["target"]) => (target === "itself" ? site.object : target === "prototype" ? site.holder.proto! : target === "prototype-above" ? site.holder.grand! : site.holder.class!);

const unique = (texts: string[]) => [...new Set(texts)].join("");

function inSequence(steps: Combination[]): Operation {
  return {
    name: steps.map(step => `${step.operation.name}@${step.target}`).join("+"),
    text: site => steps.map((step, index) => `try {\n${step.operation.text({ ...site, object: subjectOf(site, step.target) })}} catch (e) {\nnote("change ${index} threw " + e.name);\n}\n`).join(""),
    before: site => unique(steps.map(step => step.operation.before?.(site) ?? "")),
    usesLibrary: steps.some(step => step.operation.usesLibrary),
  };
}

function oneAfterTheOther(first: Look, second: Look): Look {
  return {
    ...first,
    name: `${first.name}+${second.name}`,
    text: site => `let seenFirst;\ntry {\n${first.text(site)}seenFirst = seen;\n} catch (e) {\nseenFirst = "threw " + e.name;\n}\n{\n${second.text(site)}}\nseen = seenFirst + " & " + seen;\n`,
    before: site => unique([first.before?.(site) ?? "", second.before?.(site) ?? ""]),
    helpers: [...(first.helpers ?? []), ...(second.helpers ?? [])],
    usesLibrary: first.usesLibrary || second.usesLibrary,
  };
}

export function generate(random: Random, _typed: boolean, profile: { library: boolean } = { library: true }): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const options = { hasLibrary: profile.library };
  const first = pickCombination(pick, options, axesOf({ targets: ["itself"] }));
  const beside = axesOf({
    holders: [first.holder.name],
    integrities: [first.integrity],
    aboves: [first.above.name],
    keys: [first.key.name],
    presences: [first.isOwn ? "own" : "absent"],
    spellings: [`${first.changeSpelling}-${first.lookSpelling}`],
    places: [first.place.name],
  });
  const steps = [first];
  for (let count = pick([1, 1, 2, 3]); count > 0; count--) {
    const step = pickCombination(pick, options, beside);
    // What two changes declare in front of the program may have one name.
    if (step.operation.before && steps.some(other => other.operation.before && other.operation !== step.operation)) continue;
    steps.splice(pick(steps.map((_, index) => index).concat(steps.length)), 0, step);
  }
  const other = steps[steps.length - 1] === first ? steps[0] : steps[steps.length - 1];
  const combination = { ...first, operation: inSequence(steps), look: oneAfterTheOther(first.look, other.look) };
  return `// ${nameOf(combination)}\n${textOf(combination, profile.library ? "console.log" : "print")}`;
}
