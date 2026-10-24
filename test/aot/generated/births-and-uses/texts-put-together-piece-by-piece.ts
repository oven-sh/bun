// A text that grows by `+=`, by `+` or in a template. The pieces may be gathered and joined once at the end, and several joins may become one: as long as every reader in between, every
// copy of the text taken on the way, every conversion of a piece that runs code, and every handler that catches half a text sees what it would have seen.
// Where the text is kept x what is added x who looks at it on the way, each in every place.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type Home = { beside?: string; before: (seed: string) => string; text: string };
const homes: Record<string, Home> = {
  variable: { before: seed => `let text = "s" + ${seed};`, text: "text" },
  emptyVariable: { before: () => `let text = "";`, text: "text" },
  variableHeldByAClosure: { beside: "const readers: (() => string)[] = [];", before: seed => `let text = "s" + ${seed}; readers.push(() => text);`, text: "text" },
  moduleVariable: { beside: `let text = "";`, before: seed => `text = "s" + ${seed};`, text: "text" },
  field: { before: seed => `const holder = { text: "s" + ${seed}, more: 1 };`, text: "holder.text" },
  fieldOfOneOfTwo: { before: seed => `const holder = ${seed} % 2 ? { text: "s" + ${seed}, more: 1 } : { text: "z", more: ${seed} };`, text: "holder.text" },
  fieldOfAnInstance: { beside: "class Keeper { text: string; constructor(text: string) { this.text = text; } }", before: seed => `const holder = new Keeper("s" + ${seed});`, text: "holder.text" },
  element: { before: seed => `const list = ["s" + ${seed}, "other"];`, text: "list[0]" },
  entryUnderAKey: { before: seed => `const table: Record<string, string> = { k1: "s" + ${seed} }; const key = "k" + (${seed} > -1 ? 1 : 2);`, text: "table[key]" },
};

const pieces: Record<string, { beside?: string; text: (turn: string) => string }> = {
  literal: { text: () => `"ab"` },
  character: { text: turn => `"abcdef"[(${turn}) % 6]` },
  whole: { text: turn => `(${turn})` },
  fraction: { text: turn => `((${turn}) + 0.25)` },
  negativeZero: { text: turn => `((${turn}) * -0)` },
  large: { text: turn => `((${turn}) * 1e21 + 1e21)` },
  truth: { text: turn => `((${turn}) % 2 === 0)` },
  nothing: { text: turn => `((${turn}) % 2 ? undefined : null)` },
  wide: { text: turn => `((${turn}) % 2 ? "é€" : "😀")` },
  halfOfAPair: { text: turn => `"😀"[(${turn}) % 2]` },
  template: { text: turn => "`<${" + turn + "}|${(" + turn + ") + 1}>`" },
  slice: { text: turn => `"abcdefgh".slice((${turn}) % 3, 5)` },
  itself: { text: () => "@" },
  list: { text: turn => `[${turn}, [1, 2]]` },
  objectThatSpeaks: { beside: `let spoken = 0;\nconst speaker = { toString(): string { spoken++; say("speaks", spoken); return "o" + spoken; } };`, text: () => "speaker" },
  objectThatChangesTheText: { text: () => "changer" },
  objectThatThrows: { beside: `let asked = 0;\nconst thrower = { toString(): string { if (++asked % 3 === 0) throw new RangeError("stop"); return "t" + asked; } };`, text: () => "thrower" },
  callThatSays: { beside: `function piece(turn: number): string { say("piece", turn); return "p" + turn; }`, text: turn => `piece(${turn})` },
  bigInteger: { text: turn => `(BigInt(${turn}) * 12345678901234567890n)` },
};

const ways: Record<string, (text: string, piece: string, other: string) => string> = {
  adds: (text, piece, other) => `${text} += ${piece}; ${other}`,
  addsTwice: (text, piece, other) => `${text} += ${piece}; ${other} ${text} += ${piece};`,
  addsTwoAtOnce: (text, piece, other) => `${text} += ${piece} + "," + ${piece}; ${other}`,
  addsInFront: (text, piece, other) => `${text} = ${piece} + ${text}; ${other}`,
  addsOnBothSides: (text, piece, other) => `${text} = "(" + ${text} + ${piece} + ")"; ${other}`,
  addsInATemplate: (text, piece, other) => `${text} = \`\${${text}}-\${${piece}}\`; ${other}`,
  addsInALoop: (text, piece, other) => `for (let at = 0; at < 3; at++) { ${text} += ${piece}; ${other} }`,
  addsInALoopOnSomeTurns: (text, piece, other) => `for (let at = 0; at < 4; at++) { if (at % 2) ${text} += ${piece}; else ${text} += "."; ${other} }`,
  addsOnOneOfTwoWays: (text, piece, other) => `if (${text}.length % 2) ${text} += ${piece}; else ${text} += "e" + ${piece}; ${other}`,
  addsByConcat: (text, piece, other) => `${text} = ${text}.concat(String(${piece}), "!"); ${other}`,
  isMadeATextThatBecomesPartOfAKey: (text, piece, other) => `{ const asText = \`\${${piece}}\`; ${other} counts[asText + "k"] = ${text}.length; }`,
  getsAPieceAheadOfACallThatMayThrow: (text, piece, other) => `${text} = ${text} + "a" + ${piece} + orStop(${text}.length); ${other}`,
  growsWhileWhatItWasIsStillHeld: (text, piece, other) => `const was = ${text}; ${text} += ${piece}; ${other} ${text} += "."; say(was.length, was.slice(-2));`,
  growsInALoopWhileWhatItWasIsStillHeld: (text, piece, other) => `let was = ""; for (let at = 0; at < 3; at++) { if (at === 1) was = ${text}; ${text} += ${piece}; ${other} } say(was.length, was.slice(-2));`,
  startsAnewNowAndThen: (text, piece, other) => `if (${text}.length > 12) ${text} = ""; ${text} += ${piece}; ${other}`,
};

const others: Record<string, (text: string) => string> = {
  nobody: () => "",
  itsLength: text => `say(${text}.length);`,
  oneCharacter: text => `say(${text}[${text}.length - 1], ${text}.charCodeAt(0));`,
  aCopy: text => `copies.push(${text});`,
  aCopyOnSomeTurns: text => `if (${text}.length % 3 === 0) copies.push(${text});`,
  aComparison: text => `say(${text} === copies[copies.length - 1], ${text} < "t");`,
  aKey: text => `counts[${text}] = (counts[${text}] ?? 0) + 1;`,
  aSearch: text => `say(${text}.indexOf("a"), ${text}.endsWith("b"));`,
  aFunction: text => `look(${text});`,
  aThrow: text => `fail(${text}.length % 7 === 0);`,
  aHandler: text => `try { fail(${text}.length % 2 === 0); } catch (error) { say("inside", ${text}); }`,
};

function stretch(homeName: string, pieceName: string, wayName: string, otherName: string): Stretch {
  const [home, piece] = [homes[homeName], pieces[pieceName]];
  const changer = pieceName === "objectThatChangesTheText" ? `const changer = { toString(): string { ${home.text} += "!"; return "c"; } };` : "";
  const isOutside = homeName === "moduleVariable";
  return {
    name: `${homeName}-${pieceName}-${wayName}-${otherName}`,
    beside: `const copies: string[] = [];\nconst counts: Record<string, number> = {};\nfunction look(text: string): void { say("look", text.length, text.slice(-3)); }\nfunction orStop(length: number): string { fail(length % 5 === 2); return "."; }\nfunction left(): string { const all = copies.join("|") + "/" + Object.keys(counts).join("|"); copies.length = 0; for (const key in counts) delete counts[key]; return all; }\n${home.beside ?? ""}\n${piece.beside ?? ""}\n${isOutside ? changer : ""}`,
    before: seed => `${home.before(seed)} ${isOutside ? "" : changer}`,
    body: turn => ways[wayName](home.text, piece.text(turn).replaceAll("@", home.text), others[otherName](home.text)),
    after: `${home.text} + "/" + left()${homeName === "variableHeldByAClosure" ? ` + "/" + readers[readers.length - 1]()` : ""}`,
  };
}

const fewPlaces = ["once", "often", "loop", "loopWithContinue", "handlerInALoop", "loopUnderAHandler", "handlerAndCleanup", "copiedIntoALoop", "inAClosure", "loopWithAYield", "loopWithAnAwait", "moduleLoop"];

export const oneIn = 260;

export function programs(isTyped?: boolean) {
  const [pieceNames, homeNames] = [Object.keys(pieces), Object.keys(homes)];
  const everywhere: Stretch[] = [];
  let at = 0;
  for (const home in homes) for (const way in ways) for (const other in others) everywhere.push(stretch(home, pieceNames[at++ % pieceNames.length], way, other));
  const names = new Set(everywhere.map(each => each.name));
  const inFewPlaces: Stretch[] = [];
  at = 0;
  for (const piece in pieces)
    for (const way in ways)
      for (const other in others) {
        const made = stretch(homeNames[at++ % homeNames.length], piece, way, other);
        if (!names.has(made.name)) inFewPlaces.push(made);
      }
  return [...inEveryPlace(everywhere, isTyped), ...inEveryPlace(inFewPlaces, isTyped, fewPlaces)];
}
