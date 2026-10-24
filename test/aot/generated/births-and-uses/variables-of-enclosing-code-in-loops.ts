// A loop that reads or stores a variable of its module, of an enclosing function, or a static member. What the loop reads may be read once ahead of it, what it stores may be stored once
// behind it, and between the two the value may go around the loop in a register: all of it only while nobody else looks at the variable or changes it before the loop is over.
// Where the variable lives x what a turn does with it x who else comes by in that turn, and what it holds x what a turn does x the form of the loop: each in every place.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type Kind = { type: string; first: (seed: string) => string; next: (held: string, by: string) => string; show: (held: string) => string };
const kinds: Record<string, Kind> = {
  whole: { type: "number", first: seed => `${seed}`, next: (held, by) => `${held} + ${by} + 1`, show: held => held },
  fraction: { type: "number", first: seed => `${seed} + 0.5`, next: (held, by) => `${held} * 1.5 + ${by}`, show: held => held },
  wholeAtItsBorder: { type: "number", first: seed => `2147483644 + ${seed}`, next: (held, by) => `${held} + 1 + ${by} % 2`, show: held => held },
  text: { type: "string", first: seed => `"t" + ${seed}`, next: (held, by) => `${held} + ${by}`, show: held => held },
  object: { type: "{ value: number }", first: seed => `{ value: ${seed} }`, next: (held, by) => `{ value: ${held}.value + ${by} + 1 }`, show: held => `${held}.value` },
  list: { type: "number[]", first: seed => `[${seed}]`, next: (held, by) => `[...${held}, ${by}]`, show: held => `${held}.join("+")` },
  sometimesNothing: { type: "number | undefined", first: seed => `${seed} > 1 ? undefined : ${seed}`, next: (held, by) => `${by} % 2 ? undefined : (${held} ?? 0) + ${by}`, show: held => `String(${held})` },
};

type Helper = "peek" | "poke" | "probe" | "converter" | "changers" | "proxy";
const helpers = (kind: Kind, held: string, needs: Helper[]) =>
  [
    needs.includes("peek") && `function peek(): void { say("peek", ${kind.show(held)}); }`,
    needs.some(need => need !== "peek") && `function poke(by: number): void { ${held} = ${kind.next(held, "by")}; }`,
    needs.includes("probe") && `const probe = { get now(): string { poke(1); return "g"; } };`,
    needs.includes("converter") && `const converter = { toString(): string { poke(2); return "c"; } };`,
    needs.includes("changers") && `const changers: ((by: number) => void)[] = [poke, () => {}, poke];`,
    needs.includes("proxy") && `const proxy = new Proxy({} as Record<string, string>, { get(): string { poke(3); return "p"; } });`,
  ]
    .filter(Boolean)
    .join(" ");

type Observer = { needs?: Helper[]; text: string; around?: (loop: string, shown: string) => string; suspends?: "await" | "yield"; returns?: true };
const observers: Record<string, Observer> = {
  nobody: { text: "" },
  aReader: { needs: ["peek"], text: "peek();" },
  aWriter: { needs: ["poke"], text: "poke(at);" },
  aReaderOnOneTurn: { needs: ["peek"], text: "if (at === 1) peek();" },
  aWriterOnOneTurn: { needs: ["poke"], text: "if (at === 1) poke(at);" },
  aReaderUnderABuiltIn: { needs: ["peek"], text: "[at].forEach(() => peek());" },
  aWriterUnderAGetter: { needs: ["probe"], text: "seen += probe.now;" },
  aWriterUnderAConversion: { needs: ["converter"], text: "seen += `${converter}`;" },
  aWriterUnderABuiltIn: { needs: ["poke"], text: "[at].forEach(by => poke(by));" },
  aWriterUnderANative: { needs: ["poke"], text: `seen += "x".replace("x", () => (poke(at), "r"));` },
  aWriterUnderAProxy: { needs: ["proxy"], text: "seen += proxy.any;" },
  aWriterOutOfAList: { needs: ["changers"], text: "changers[at % 3](at);" },
  aWriterByReflect: { needs: ["poke"], text: "Reflect.apply(poke, undefined, [at]);" },
  aBuiltInThatThrowsOnOneTurn: { text: `seen += "ab".repeat(2 - at).length;`, around: (loop, shown) => `try { ${loop} } catch (error) { say("caught", (error as Error).name, ${shown}); }` },
  aBuiltInThatThrowsOutOfTheFunction: { text: `seen += "ab".repeat(2 - at).length;` },
  aHandlerInTheTurn: { needs: ["peek"], text: "try { fail(at === 1); } catch (error) { peek(); }" },
  aHandlerAroundTheLoop: { text: "fail(at === 2);", around: (loop, shown) => `try { ${loop} } catch (error) { say("caught", ${shown}); }` },
  aCleanupAroundTheLoop: { text: "if (at === 2) return;", returns: true, around: (loop, shown) => `try { ${loop} } finally { say("finally", ${shown}); }` },
  whoeverRunsAtAnAwait: { text: "await null;", suspends: "await" },
  whoeverTakesTheSteps: { text: "yield seen;", suspends: "yield" },
};

const accesses: Record<string, (held: string, kind: Kind, other: string) => string> = {
  reads: (held, kind, other) => `seen += "," + ${kind.show(held)}; ${other}`,
  readsOnBothSides: (held, kind, other) => `seen += "," + ${kind.show(held)}; ${other} seen += "/" + ${kind.show(held)};`,
  stores: (held, kind, other) => `${held} = ${kind.next(held, "at")}; ${other}`,
  storesThenReads: (held, kind, other) => `${held} = ${kind.next(held, "at")}; ${other} seen += "," + ${kind.show(held)};`,
  readsThenStores: (held, kind, other) => `seen += "," + ${kind.show(held)}; ${other} ${held} = ${kind.next(held, "at")};`,
  storesOnSomeTurns: (held, kind, other) => `if (at % 2) ${held} = ${kind.next(held, "at")}; ${other} seen += "," + ${kind.show(held)};`,
  storesAndLeaves: (held, kind, other) => `if (at === 2) { ${held} = ${kind.next(held, "at")}; break; } ${other} seen += "," + ${kind.show(held)};`,
  readsOnOneTurn: (held, kind, other) => `if (at === 2) seen += "," + ${kind.show(held)}; ${other}`,
  storesOnBothSides: (held, kind, other) => `${held} = ${kind.next(held, "at")}; ${other} ${held} = ${kind.next(held, "at + 1")};`,
};

const loops: Record<string, (turn: string, inner: string) => string> = {
  counted: (_, inner) => `for (let at = 0; at < 4; at++) { ${inner} }`,
  tested: (_, inner) => `let at = 0; while (at < 4) { ${inner} at++; }`,
  testedBehind: (_, inner) => `let at = 0; do { ${inner} } while (++at < 4);`,
  overAList: (_, inner) => `for (const at of [0, 1, 2, 3]) { ${inner} }`,
  insideAnother: (_, inner) => `for (let out = 0; out < 2; out++) for (let at = 0; at < 3; at++) { ${inner} }`,
  asLongAsTheTurnSays: (turn, inner) => `for (let at = 0; at < (${turn}) % 4; at++) { ${inner} }`,
};

type Home = { holdsTheLoop?: true; make: (kind: Kind, helpers: (held: string) => string, loop: (held: string, turn: string) => string) => Omit<Stretch, "name"> };
const homes: Record<string, Home> = {
  moduleLet: { make: (kind, help, loop) => ({ beside: `let held: ${kind.type} = ${kind.first("0")}; ${help("held")}`, before: seed => `held = ${kind.first(seed)};`, body: turn => loop("held", turn), after: kind.show("held") }) },
  moduleVar: { make: (kind, help, loop) => ({ beside: `var held: ${kind.type} = ${kind.first("0")}; ${help("held")}`, before: seed => `held = ${kind.first(seed)};`, body: turn => loop("held", turn), after: kind.show("held") }) },
  staticMember: { make: (kind, help, loop) => ({ beside: `class Home { static held: ${kind.type} = ${kind.first("0")}; } ${help("Home.held")}`, before: seed => `Home.held = ${kind.first(seed)};`, body: turn => loop("Home.held", turn), after: kind.show("Home.held") }) },
  sameFunction: {
    make: (kind, help, loop) => ({ beside: "const kept: (() => unknown)[] = [];", before: seed => `let held: ${kind.type} = ${kind.first(seed)}; kept.push(() => ${kind.show("held")}); ${help("held")}`, body: turn => loop("held", turn), after: "kept[kept.length - 1]()" }),
  },
  functionAbove: {
    holdsTheLoop: true,
    make: (kind, help, loop) => ({ before: seed => `let held: ${kind.type} = ${kind.first(seed)}; ${help("held")} const work = (turn: number): void => { ${loop("held", "turn")} };`, body: turn => `work(${turn});`, after: kind.show("held") }),
  },
  twoFunctionsAbove: {
    holdsTheLoop: true,
    make: (kind, help, loop) => ({ before: seed => `let held: ${kind.type} = ${kind.first(seed)}; ${help("held")} const work = (() => (turn: number): void => { ${loop("held", "turn")} })();`, body: turn => `work(${turn});`, after: kind.show("held") }),
  },
  parameterAbove: {
    holdsTheLoop: true,
    make: (kind, help, loop) => ({
      before: seed => `const scope = ((held: ${kind.type}) => { ${help("held")} return { work: (turn: number): void => { ${loop("held", "turn")} }, left: () => ${kind.show("held")} }; })(${kind.first(seed)});`,
      body: turn => `scope.work(${turn});`,
      after: "scope.left()",
    }),
  },
};

function stretch(homeName: string, kindName: string, accessName: string, observerName: string, loopName: string): Stretch | undefined {
  const [home, kind, observer] = [homes[homeName], kinds[kindName], observers[observerName]];
  if (home.holdsTheLoop && observer.suspends) return undefined;
  const loop = (held: string, turn: string) => {
    const turns = loops[loopName](turn, accesses[accessName](held, kind, observer.text));
    return `let seen = ""; ${observer.around ? observer.around(turns, kind.show(held)) : turns} say(seen);`;
  };
  return {
    name: `${homeName}-${kindName}-${accessName}-${observerName}-${loopName}`,
    ...home.make(kind, held => helpers(kind, held, observer.needs ?? []), loop),
    suspends: observer.suspends,
    returns: observer.returns && !home.holdsTheLoop ? true : undefined,
  };
}

const fewPlaces = ["once", "often", "loop", "handlerInALoop", "loopUnderAHandler", "copiedIntoALoop", "inAClosure", "moduleLoop"];

export const oneIn = 165;

/** Dealt by the names, so that what is added to a list later leaves the other programs as they are. */
const dealt = (name: string, among: number, skip = 1): number => Number((BigInt(Bun.hash(name)) / BigInt(skip)) % BigInt(among));

export function programs(isTyped?: boolean) {
  const [kindNames, loopNames] = [Object.keys(kinds), Object.keys(loops)];
  const everywhere: Stretch[] = [];
  for (const home in homes)
    for (const access in accesses)
      for (const observer in observers) {
        const pairing = `${home}-${access}-${observer}`;
        const made = stretch(home, kindNames[dealt(pairing, kindNames.length)], access, observer, loopNames[dealt(pairing, loopNames.length, 1009)]);
        if (made) everywhere.push(made);
      }
  const names = new Set(everywhere.map(each => each.name));
  const inFewPlaces: Stretch[] = [];
  for (const home of ["moduleLet", "sameFunction", "functionAbove"])
    for (const observer of ["nobody", "aWriterOnOneTurn"])
      for (const kind in kinds)
        for (const access in accesses)
          for (const loop in loops) {
            const made = stretch(home, kind, access, observer, loop)!;
            if (!names.has(made.name)) inFewPlaces.push(made);
          }
  return [...inEveryPlace(everywhere, isTyped), ...inEveryPlace(inFewPlaces, isTyped, fewPlaces)];
}
