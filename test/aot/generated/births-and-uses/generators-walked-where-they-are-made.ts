// A generator that is made only to be walked at once. Its body and the loop that walks it may become one piece of code, without a generator object and without steps. What the body does
// between two yields, what its cleanups do when the walk ends early, what it is sent, what it returns, and the order of all that with the walker's own doings stay as they were.
// What the body is x how it is walked x how the walk ends, each in many places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const bodies: Record<string, { beside?: string; text: string; type?: string }> = {
  counts: { text: `for (let at = 0; at < n; at++) yield at + from;` },
  threeYields: { text: `yield from; yield from + 1; yield from + n;` },
  saysBetween: { text: `say("start"); for (let at = 0; at < n; at++) { say("before", at); yield at + from; say("after", at); } say("end");` },
  underACleanup: { text: `try { for (let at = 0; at < n; at++) yield at + from; } finally { say("cleanup"); }` },
  underTwoCleanups: { text: `try { yield from; try { yield from + 1; yield from + 2; } finally { say("inner"); } yield from + 3; } finally { say("outer"); }` },
  cleanupThatYields: { text: `try { yield from; yield from + 1; } finally { yield -1; say("cleanup"); }` },
  cleanupThatReturns: { text: `try { yield from; yield from + 1; } finally { say("cleanup"); return; }` },
  underAHandler: { text: `for (let at = 0; at < n; at++) { try { yield at + from; } catch (error) { say("inside", (error as Error).name); yield -at; } }` },
  throwsHalfWay: { text: `yield from; fail(n > 2); yield from + 1;` },
  returnsAValue: { text: `yield from; yield from + 1; return 99;`, type: "Generator<number, number | void>" },
  returnsEarly: { text: `for (let at = 0; at < n; at++) { if (at === 2) return; yield at + from; }` },
  neverEnds: { text: `for (let at = from; ; at++) yield at;` },
  yieldsNothing: { text: `say("ran", n + from);` },
  handsOnToAnother: { beside: `function* nested(from: number): Generator<number> { try { yield from * 10; yield from * 10 + 1; } finally { say("inner cleanup"); } }`, text: `yield from; yield* nested(from); yield from + 1;` },
  handsOnToAList: { text: `yield* [from, from + 1]; yield n;` },
  readsWhatItIsSent: { text: `let sent: unknown = "none"; for (let at = 0; at < n; at++) { sent = yield at + from; say("sent", sent); }`, type: "Generator<number, void, unknown>" },
  keepsAVariable: { text: `let sum = 0; for (let at = 0; at < n; at++) { sum += at + from; yield sum; }` },
  makesClosures: { text: `for (let at = 0; at < n; at++) { later.push(() => at + from); yield at; }` },
  yieldsObjects: { text: `for (let at = 0; at < n; at++) yield { value: at + from }.value + [at, from].length;` },
  changesWhatTheWalkerReads: { text: `for (let at = 0; at < n; at++) { shared.value += 10; yield at + from; shared.value += 100; }` },
  readsWhatTheWalkerChanges: { text: `for (let at = 0; at < n; at++) yield shared.value + at;` },
  walksItself: { text: `if (n > 0) for (const deeper of steps(n - 1, from + 1)) yield deeper * 2; yield from;` },
  twoLoops: { text: `for (let out = 0; out < 2; out++) for (let at = 0; at < n; at++) yield out * 10 + at + from;` },
  yieldsInBranches: { text: `for (let at = 0; at < n; at++) { if (at % 2) yield -at; else yield at + from; }` },
  readsItsArguments: { text: `yield arguments.length; yield n + from;` },
};

const endings: Record<string, string> = {
  runsOut: "",
  breaks: `if (step > 1) break;`,
  breaksAtOnce: `break;`,
  continues: `if (step % 2) continue; say("even");`,
  throws: `fail(step > 1);`,
  returns: `if (step > 1) return;`,
  changesWhatBothSee: `shared.value++;`,
};

type Walk = { text: (made: string, ending: string) => string | undefined; needsAnEnd?: true };
const walks: Record<string, Walk> = {
  forOf: { text: (made, ending) => `let turns = 0; for (const step of ${made}) { if (++turns > 6) break; say(step); ${ending} }` },
  forOfThroughAVariable: { text: (made, ending) => `let turns = 0; const all = ${made}; for (const step of all) { if (++turns > 6) break; say(step); ${ending} } say("then", all.next().done);` },
  forOfUnderAHandler: { text: (made, ending) => `let turns = 0; try { for (const step of ${made}) { if (++turns > 6) break; say(step); ${ending} } } catch (error) { say("outside", (error as Error).name); } finally { say("walked"); }` },
  twoAtOnce: { text: (made, ending) => `let turns = 0; for (const step of ${made}) { for (const other of ${made}) { if (++turns > 9) break; say(step, other); } if (turns > 9) break; ${ending} }` },
  spread: { needsAnEnd: true, text: (made, ending) => (ending ? undefined : `say([...${made}].join("+"));`) },
  takenApart: { text: (made, ending) => (ending ? undefined : `const [first, second] = ${made}; say(first, second);`) },
  takenApartWithARest: { needsAnEnd: true, text: (made, ending) => (ending ? undefined : `const [first, ...others] = ${made}; say(first, others.length);`) },
  arrayFrom: { needsAnEnd: true, text: (made, ending) => (ending ? undefined : `say(Array.from(${made}, each => each * 2).join("+"));`) },
  byHand: { text: (made, ending) => `const all = ${made}; let turns = 0; for (let next = all.next(); !next.done; next = all.next()) { const step = next.value as number; if (++turns > 6) break; say(step); ${ending} }` },
  byHandAndSends: { text: (made, ending) => (ending ? undefined : `const all = ${made}; say(all.next("a").value, all.next("b").value, all.next("c").done);`) },
  byHandAndEnds: { text: (made, ending) => (ending ? undefined : `const all = ${made}; say(all.next().value); say(JSON.stringify(all.return(7 as never))); say(all.next().done);`) },
  byHandAndThrows: { text: (made, ending) => (ending ? undefined : `const all = ${made}; say(all.next().value); try { say(JSON.stringify(all.throw(new RangeError("sent")))); } catch (error) { say("came back", (error as Error).name); } say(all.next().done);`) },
  asArguments: { needsAnEnd: true, text: (made, ending) => (ending ? undefined : `say(Math.max(0, ...${made}));`) },
  intoASet: { needsAnEnd: true, text: (made, ending) => (ending ? undefined : `say(new Set(${made}).size);`) },
};

function stretch(bodyName: string, walkName: string, endingName: string): Stretch | undefined {
  const [body, walk] = [bodies[bodyName], walks[walkName]];
  if (walk.needsAnEnd && bodyName === "neverEnds") return undefined;
  const text = (turn: string) => walk.text(`steps((${turn}) % 3 + 2, start)`, endings[endingName]);
  if (text("0") === undefined) return undefined;
  return {
    name: `${bodyName}-${walkName}-${endingName}`,
    beside: `const shared = { value: 0 };\nconst later: (() => number)[] = [];\n${body.beside ?? ""}\nfunction* steps(n: number, from: number): ${body.type ?? "Generator<number>"} { ${body.text} }\nfunction left(): string { const text = shared.value + "/" + later.map(each => each()).join("+"); shared.value = 0; later.length = 0; return text; }`,
    before: seed => `const start = ${seed};`,
    body: turn => text(turn)!,
    after: "left()",
    returns: endingName === "returns" ? true : undefined,
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "twoLoops", "loopWithContinue", "loopWithBreak", "handlerInALoop", "loopUnderAHandler", "cleanup", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "callsItself", "loopWithAYield", "yieldUnderACleanup", "loopWithAnAwait"];

export const oneIn = 50;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const body in bodies)
    for (const walk in walks)
      for (const ending in endings) {
        const made = stretch(body, walk, ending);
        if (made) all.push(made);
      }
  return inEveryPlace(all, isTyped, somePlaces);
}
