// Each time the text of a program comes to a pattern literal there is a new object, which starts its search at the front and bears no name that an older one was given. One object may serve
// every time as long as nobody can tell.
// The literal x what is done with it x whether the program then asks where the search stopped, each in every place: most of all those that come to the literal again and again.
// Who does not ask still finds out: the next search through the same object begins where the last one ended.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const beside = `function uses(pattern: RegExp, text: string): string { return pattern.test(text) + ":" + pattern.lastIndex; }
const table: Record<string, (given: unknown) => unknown> = { same: given => given };
function unknown<T>(given: T): T { return table["sa" + "me"](given) as T; }
let last: RegExp | undefined;
`;

const literals: Record<string, string> = {
  plain: "/a+/",
  global: "/a+/g",
  sticky: "/a+/y",
  globalAndSticky: "/a+/gy",
  withGroups: "/(a)(X)?/g",
  ignoringCase: "/A+/gi",
  unicode: "/a+/gu",
  withIndices: "/(?<first>a)/dg",
  matchingNothing: "/$/g",
  matchingTheEmptyText: "/a|/g",
};

const uses: Record<string, (turn: string) => string> = {
  test: () => `say(pattern.test(text));`,
  testTwice: () => `say(pattern.test(text), pattern.test(text));`,
  exec: () => `say(pattern.exec(text)?.index);`,
  execWhileItFinds: () => `for (let found, tries = 0; tries++ < 9 && (found = pattern.exec(text)); ) { say(found.index); if (found[0] === "") pattern.lastIndex++; if (!pattern.global && !pattern.sticky) break; }`,
  match: () => `say(text.match(pattern)?.length);`,
  matchAll: () => `say([...text.matchAll(pattern)].length);`,
  replace: () => `say(text.replace(pattern, "-"));`,
  replaceByAFunction: () => `say(text.replace(pattern, found => found.length + "" + pattern.lastIndex));`,
  replaceAll: () => `say(text.replaceAll(pattern, "-"));`,
  search: () => `say(text.search(pattern));`,
  split: () => `say(text.split(pattern).length);`,
  testBehindAMatch: () => `text.match(pattern); say(pattern.test(text));`,
  startsFurtherOn: () => `pattern.lastIndex = 2; say(pattern.test(text));`,
  startsWhereAnObjectSays: () => `pattern.lastIndex = { valueOf() { say("asked"); return 1; } } as never; say(pattern.test(text));`,
  isGivenAName: turn => `say((pattern as any).extra); (pattern as any).extra = ${turn};`,
  isKept: () => `kept.push(pattern); say(kept.length > 1 && kept[0] === kept[kept.length - 1]);`,
  isKeptBehindATest: () => `pattern.test(text); kept.push(pattern);`,
  isKeptAheadOfATest: () => `kept.push(pattern); pattern.test(text);`,
  isComparedWithTheLast: () => `say(last === pattern); last = pattern;`,
  isHandedToAFunction: () => `say(uses(pattern, text));`,
  isHandedToAFunctionTwice: () => `say(uses(pattern, text), uses(pattern, text));`,
  isHandedToUnknownCode: () => `say(unknown(pattern).test(text));`,
  tellsItsText: () => `say(pattern.source + pattern.flags, String(pattern));`,
  tellsItsNames: () => `say(Object.keys(pattern).length, Object.getOwnPropertyNames(pattern).join());`,
  isFrozen: () => `Object.freeze(pattern); say(pattern.test(text));`,
  isCompiledAnew: () => `say(pattern.test(text)); pattern.compile("b", "g"); say(pattern.test(text), pattern.source);`,
  hasAnExecOfItsOwn: () => `(pattern as any).exec = () => null; say(pattern.test(text));`,
  hasAMatchOfItsOwn: () => `(pattern as any)[Symbol.match] = () => ["own"]; say(text.match(pattern)?.[0]);`,
  isCopied: () => `pattern.test(text); const copy = new RegExp(pattern); say(copy === pattern, copy.lastIndex, RegExp(pattern) === pattern);`,
  hasTwoNames: () => `const same = pattern; same.lastIndex = 3; say(pattern.lastIndex, pattern.test(text));`,
  isOneOfTwo: turn => `const chosen = ${turn} % 2 ? pattern : /b/g; chosen.test(text); say(chosen.lastIndex);`,
  isLeftHalfWay: turn => `pattern.test(text); fail(${turn} === 2); pattern.test(text);`,
  isHeldByAClosure: () => `const again = () => pattern.test(text); say(again(), again());`,
  isHeldByAClosureThatIsKept: () => `asked.push(() => pattern.test(text) + ":" + pattern.lastIndex);`,
  isAMemberOfAList: () => `const both = [pattern, /X/g]; for (const each of both) say(each.test(text), each.lastIndex);`,
  isAFieldOfAnObject: () => `const holder = { pattern }; holder.pattern.test(text); say(holder.pattern.lastIndex);`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 120;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const literal in literals)
    for (const use in uses)
      for (const behind of ["whereItStoppedIsRead", "nothingMoreIsAsked"])
      all.push({
        name: `${literal}-${use}-${behind}`,
        beside,
        before: seed => `const text = "aXbaaXab" + ${seed}; const kept: RegExp[] = []; const asked: (() => string)[] = [];`,
        body: turn => `const pattern = ${literals[literal]}; ${uses[use](turn)} ${behind === "whereItStoppedIsRead" ? "say(pattern.lastIndex);" : ""}`,
        after: `kept.map(each => each.lastIndex + each.source).join("/") + asked.map(each => each()).join("/")`,
      });
  return alsoWithTypesErased(inEveryPlace(all.map(named), isTyped), isTyped);
}
