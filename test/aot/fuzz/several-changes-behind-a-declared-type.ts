// Several points of the table in ../generated/typed-object-mutations.ts on one object: two to four changes that no type forbids, of the object itself and of what stands above it, one behind the other in a drawn order, and two looks through the typed reference.
import { axesOf, nameOf, pickCombination, textOf, type Combination } from "../generated/typed-object-mutations";
import type { Random } from "./random";

type Change = Combination["change"];
type Look = Combination["look"];

const unique = (texts: string[]) => [...new Set(texts)].join("");

function inSequence(steps: Combination[]): Change {
  const { holder } = steps[0];
  return {
    name: steps.map(step => `${step.change.name}@${step.target}`).join("+"),
    text: site =>
      steps
        .map((step, index) => {
          const subject = step.target === "itself" ? site.object : step.target === "prototype" ? holder.proto! : holder.grand!;
          const alias = step.change.alias?.(site.key);
          const text = alias ? `const changed: ${alias} = ${subject};\n${step.change.text({ ...site, object: "changed" })}` : step.change.text({ ...site, object: subject });
          return `try {\n${text}} catch (e) {\nnote("change ${index} THROWS " + kindOf(e));\n}\n`;
        })
        .join(""),
    before: unique(steps.map(step => step.change.before ?? "")),
  };
}

function oneAfterTheOther(first: Look, second: Look): Look {
  return {
    ...first,
    name: `${first.name}+${second.name}`,
    text: site => `let seenFirst = "";\ntry {\n${first.text(site)}seenFirst = seen;\n} catch (e) {\nseenFirst = "THROWS " + kindOf(e);\n}\n{\n${second.text(site)}}\nseen = seenFirst + " & " + seen;\n`,
    before: unique([first.before ?? "", second.before ?? ""]),
    helpers: [...(first.helpers ?? []), ...(second.helpers ?? [])],
  };
}

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const first = pickCombination(pick, axesOf({ targets: ["itself"], callees: ["inline"] }));
  const beside = axesOf({
    holders: [first.holder.name],
    aboves: [first.above.name],
    keys: [first.key.name],
    presences: [first.isOwn ? "own" : "absent"],
    spellings: [first.spelling],
    places: [first.place.name],
    callees: ["inline"],
  });
  const steps = [first];
  for (let count = pick([1, 1, 2, 3]); count > 0; count--) {
    const step = pickCombination(pick, beside);
    // What two changes declare in front of the program may have one name.
    if (step.change.before && steps.some(other => other.change.before && other.change !== step.change)) continue;
    steps.splice(pick(steps.map((_, index) => index).concat(steps.length)), 0, step);
  }
  const other = steps[steps.length - 1] === first ? steps[0] : steps[steps.length - 1];
  const combination = { ...first, change: inSequence(steps), look: oneAfterTheOther(first.look, other.look) };
  return `// ${nameOf(combination)}\n${textOf(combination)}`;
}
