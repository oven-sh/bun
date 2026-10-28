// A function whose last act is a call of itself may become a loop. Each call had parameters, variables and an `arguments` of its own, and a closure made in one call goes on seeing that
// call's: a loop has to give every turn its own as well. How the function is written x where the call stands x what a turn makes, and what goes from turn to turn x what a turn makes.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type Round = { parameters: string; handedOn: string; result: string; type: string; isDone: string; next: string; first: (start: string, turn: string) => string; step?: string; show: string };
const rounds: Record<string, Round> = {
  counts: { parameters: "n: number, sum: number", handedOn: "n, sum", type: "number", isDone: "n <= 0", result: "sum", next: "n - 1, sum + n", first: (start, turn) => `(${turn}) % 3 + 3, ${start}`, show: "n * 100 + sum" },
  turnsTwoAround: { parameters: "n: number, a: number, b: number", handedOn: "n, a, b", type: "number", isDone: "n <= 0", result: "a * 1000 + b", next: "n - 1, b, a + b", first: (start, turn) => `(${turn}) % 3 + 3, ${start}, 1`, show: "a * 100 + b" },
  swapsTwoTexts: { parameters: "n: number, a: string, b: string", handedOn: "n, a, b", type: "string", isDone: "n <= 0", result: "a + b", next: "n - 1, b, a", first: (start, turn) => `(${turn}) % 2 + 3, "a" + ${start}, "b"`, show: "a + n + b" },
  storesToItsParameters: { parameters: "n: number, sum: number", handedOn: "n, sum", type: "number", isDone: "n <= 0", result: "sum", step: "sum += n; n--;", next: "n, sum", first: (start, turn) => `(${turn}) % 3 + 3, ${start}`, show: "n * 100 + sum" },
  fillsOneObject: { parameters: "n: number, box: { sum: number }", handedOn: "n, box", type: "number", isDone: "n <= 0", result: "box.sum", step: "box.sum += n;", next: "n - 1, box", first: (start, turn) => `(${turn}) % 3 + 3, { sum: ${start} }`, show: "n * 100 + box.sum" },
  makesAnObject: { parameters: "n: number, box: { sum: number }", handedOn: "n, box", type: "number", isDone: "n <= 0", result: "box.sum", next: "n - 1, { sum: box.sum + n }", first: (start, turn) => `(${turn}) % 3 + 3, { sum: ${start} }`, show: "n * 100 + box.sum" },
  makesAList: { parameters: "n: number, all: number[]", handedOn: "n, all", type: "string", isDone: "n <= 0", result: `all.join("+")`, next: "n - 1, [...all, n]", first: (start, turn) => `(${turn}) % 3 + 3, [${start}]`, show: "n * 100 + all.length" },
  joinsAText: { parameters: "n: number, text: string", handedOn: "n, text", type: "string", isDone: "n <= 0", result: "text", next: "n - 1, text + n", first: (start, turn) => `(${turn}) % 3 + 3, "t" + ${start}`, show: "text + n" },
  leavesOneOut: { parameters: "n: number, sum = n * 2", handedOn: "n, sum", type: "number", isDone: "n <= 0", result: "sum", next: "n - 1", first: (start, turn) => `(${turn}) % 3 + 3, ${start}`, show: "n * 100 + sum" },
  takesTheRest: { parameters: "n: number, ...more: number[]", handedOn: "n, ...more", type: "string", isDone: "n <= 0", result: `more.join("+")`, next: "n - 1, ...more, n", first: (start, turn) => `(${turn}) % 3 + 3, ${start}`, show: "n * 100 + more.length" },
  takesAnObjectApart: { parameters: "{ n, sum }: { n: number; sum: number }", handedOn: "{ n, sum }", type: "number", isDone: "n <= 0", result: "sum", next: "{ n: n - 1, sum: sum + n }", first: (start, turn) => `{ n: (${turn}) % 3 + 3, sum: ${start} }`, show: "n * 100 + sum" },
  growsPastWholeNumbers: { parameters: "n: number, sum: number", handedOn: "n, sum", type: "number", isDone: "n <= 0", result: "sum", next: "n - 1, sum * 70000 + 1", first: (start, turn) => `(${turn}) % 3 + 3, ${start}`, show: "sum" },
  becomesAFraction: { parameters: "n: number, sum: number", handedOn: "n, sum", type: "number", isDone: "n <= 0", result: "sum", next: "n - 1, n === 2 ? sum + 0.5 : sum + 1", first: (start, turn) => `(${turn}) % 3 + 3, ${start}`, show: "sum" },
  changesItsKind: { parameters: "n: number, value: number | string", handedOn: "n, value", type: "number | string", isDone: "n <= 0", result: "value", next: `n - 1, n % 2 ? String(value) + "s" : n`, first: (start, turn) => `(${turn}) % 3 + 3, ${start}`, show: "typeof value + value" },
  goesVeryDeep: { parameters: "n: number, sum: number", handedOn: "n, sum", type: "number", isDone: "n <= 0", result: "sum", next: "n - 1, (sum + n) % 1000", first: (start, turn) => `60000 + (${turn}), ${start}`, show: "n * 1000 + sum" },
};

const makes: Record<string, { text: (show: string) => string; needsArguments?: true }> = {
  nothing: { text: () => "" },
  aClosureOverItsParameters: { text: show => `later.push(() => ${show});` },
  aClosureOverAVariable: { text: show => `const mine = ${show}; later.push(() => mine);` },
  aClosureThatCounts: { text: () => `let count = n; later.push(() => ++count);` },
  anObject: { text: show => `const made = { seen: ${show} }; later.push(() => made.seen);` },
  aListThatStays: { text: show => `const pair = [${show}, n]; trace += String(pair[0]).length + pair.length;` },
  aLookAtItsArguments: { text: () => `trace += arguments.length; if (n < 9) say(JSON.stringify(arguments[0]), JSON.stringify(arguments[1]));`, needsArguments: true },
  aKeptArguments: { text: () => `const mine = arguments; later.push(() => mine.length + ":" + JSON.stringify(mine[0]) + JSON.stringify(mine[1]));`, needsArguments: true },
  aHandler: { text: show => `try { fail(n === 2); } catch (error) { later.push(() => "caught" + ${show}); }` },
  aLoop: { text: show => `for (let at = 0; at < 2; at++) later.push(() => at + ":" + ${show});` },
  aWord: { text: show => `if (n < 9) say(${show});` },
};

const tails: Record<string, (round: Round, call: string) => string> = {
  behindATest: (r, call) => `if (${r.isDone}) return ${r.result}; return ${call};`,
  underATest: (r, call) => `if (!(${r.isDone})) return ${call}; return ${r.result};`,
  inAChoice: (r, call) => `return ${r.isDone} ? ${r.result} : ${call};`,
  firstInAChoice: (r, call) => `return !(${r.isDone}) ? ${call} : ${r.result};`,
  behindAnAnd: (r, call) => `return ${r.isDone} ? ${r.result} : ((n > -1000 && ${call}) as ${r.type});`,
  behindAComma: (r, call) => `return ${r.isDone} ? ${r.result} : (trace++, ${call});`,
  inACase: (r, call) => `switch (${r.isDone}) { case true: return ${r.result}; default: return ${call}; }`,
  inALoop: (r, call) => `for (;;) { if (${r.isDone}) return ${r.result}; return ${call}; }`,
  inTwoPlaces: (r, call) => `if (${r.isDone}) return ${r.result}; if (n % 2) return ${call}; trace++; return ${call};`,
  underAHandler: (r, call) => `try { if (${r.isDone}) return ${r.result}; return ${call}; } catch (error) { trace++; throw error; }`,
  underACleanup: (r, call) => `try { if (${r.isDone}) return ${r.result}; return ${call}; } finally { trace++; }`,
  inAHandler: (r, call) => `try { fail(!(${r.isDone})); return ${r.result}; } catch (error) { return ${call}; }`,
  throughAVariable: (r, call) => `if (${r.isDone}) return ${r.result}; const answer = ${call}; return answer;`,
};

type Form = { hasNoArguments?: true; make: (round: Round, body: (self: (list: string) => string) => string) => { beside?: string; before?: string; call: (list: string) => string; after?: string } };
const forms: Record<string, Form> = {
  declared: { make: (r, body) => ({ beside: `function walk(${r.parameters}): ${r.type} { ${body(list => `walk(${list})`)} }`, call: list => `walk(${list})` }) },
  arrow: { hasNoArguments: true, make: (r, body) => ({ beside: `const walk = (${r.parameters}): ${r.type} => { ${body(list => `walk(${list})`)} };`, call: list => `walk(${list})` }) },
  namedInside: { make: (r, body) => ({ beside: `const outside = function walk(${r.parameters}): ${r.type} { ${body(list => `walk(${list})`)} };`, call: list => `outside(${list})` }) },
  insideAnother: { make: (r, body) => ({ before: `let calls = 0; function walk(${r.parameters}): ${r.type} { calls++; ${body(list => `walk(${list})`)} }`, call: list => `walk(${list})`, after: "calls" }) },
  method: { make: (r, body) => ({ beside: `class Walker { calls = 0; walk(${r.parameters}): ${r.type} { this.calls++; ${body(list => `this.walk(${list})`)} } }`, call: list => `new Walker().walk(${list})` }) },
  staticMethod: { make: (r, body) => ({ beside: `class Walker { static walk(${r.parameters}): ${r.type} { ${body(list => `Walker.walk(${list})`)} } }`, call: list => `Walker.walk(${list})` }) },
  memberOfALiteral: { make: (r, body) => ({ beside: `const walker = { walk(${r.parameters}): ${r.type} { ${body(list => `walker.walk(${list})`)} } };`, call: list => `walker.walk(${list})` }) },
  twoInTurn: { make: (r, body) => ({ beside: `function walk(${r.parameters}): ${r.type} { ${body(list => `other(${list})`)} }\nfunction other(${r.parameters}): ${r.type} { return walk(${r.handedOn}); }`, call: list => `walk(${list})` }) },
};

const common = `const later: (() => unknown)[] = [];
let trace = 0;
function drain(): string { const all = later.map(each => each()); later.length = 0; const left = trace; trace = 0; return all.length + ":" + all.slice(0, 5).join("|") + ".." + all.slice(-2).join("|") + "/" + left; }
`;

function stretch(formName: string, tailName: string, roundName: string, makeName: string): Stretch | undefined {
  const [form, round, make] = [forms[formName], rounds[roundName], makes[makeName]];
  if (form.hasNoArguments && make.needsArguments) return undefined;
  // Where the call is not the last act, how deep it may go is the stack's business.
  if (roundName === "goesVeryDeep" && ["underAHandler", "underACleanup", "inAHandler", "throughAVariable"].includes(tailName)) return undefined;
  // TODO: that deep, what plain Bun reads out of `arguments` goes by the tier that runs the function, so there is nothing to hold the executable against.
  if (roundName === "goesVeryDeep" && makeName === "aLookAtItsArguments") return undefined;
  const made = form.make(round, self => `${make.text(round.show)} ${round.step ?? ""} ${tails[tailName](round, self(round.next))}`);
  return {
    name: `${formName}-${tailName}-${roundName}-${makeName}`,
    beside: common + (made.beside ?? ""),
    before: seed => `const start = ${seed}; ${made.before ?? ""}`,
    body: turn => `say(${made.call(round.first("start", turn))});`,
    after: made.after ? `drain() + "/" + ${made.after}` : "drain()",
  };
}

const somePlaces = ["once", "often", "module", "loop", "twoLoops", "loopWithBreak", "handlerInALoop", "cleanup", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "loopWithAYield", "loopWithAnAwait"];

export const oneIn = 60;

export function programs(isTyped?: boolean) {
  const roundNames = Object.keys(rounds);
  const all = new Map<string, Stretch>();
  let at = 0;
  for (const form in forms)
    for (const tail in tails)
      for (const make in makes) {
        const made = stretch(form, tail, roundNames[at++ % roundNames.length], make);
        if (made) all.set(made.name, made);
      }
  for (const form of ["declared", "insideAnother", "method", "twoInTurn"])
    for (const round in rounds)
      for (const make in makes)
        for (const tail of ["behindATest", "inAChoice"]) {
          const made = stretch(form, tail, round, make);
          if (made) all.set(made.name, made);
        }
  return inEveryPlace([...all.values()], isTyped, somePlaces);
}
