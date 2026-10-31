// `let place = 0; function* g() { yield 1; place = 5; yield 2; }` and a caller that reads `place`, steps the generator and reads
// `place` again in the same function. A step runs whatever stands behind the yield, so the second read may not be answered by the
// first. Each scene varies the place (a variable of the module or of an enclosing function, a field, an element, a length, a Map, a
// Set, a binding of a function, a static field, whether a name is there, whether an object is frozen), where the write stands (in
// front of the first yield, behind the n-th, behind the last, in a loop, in finally or catch, in a function or a generator that
// the body calls) and how the caller steps: by hand, spread, for-of, destructuring, Array.from, a helper, iterator helpers,
// return(), throw(), a loop whose condition is the read, `yield*` from a generator of its own, or an iterator it was handed.
import type { Random } from "./random";

interface Place {
  /** `@N` is the number of the scene. */
  declare: string;
  typedDeclare?: string;
  /** Puts the place back, in front of the first read. It is a second store to the place, in the caller: half the scenes leave it out. */
  reset?: string;
  read: string;
  /** `@V` is a number that no write has used yet. */
  write: string;
  /** The read is a number that the writes only raise. */
  isCount?: true;
  isOnlyUntyped?: true;
  /** The write stores to the binding of the generator function, which TypeScript only lets a variable take. */
  isOwnName?: true;
  /** A function declaration that another declaration stores to. Moved to a file of its own it would be an import, which nothing may store to. */
  isStoredToFromOutside?: true;
}

const places: Place[] = [
  // Variables that nothing stores to but the generator, behind its yield: not a reset, not even an initializer.
  {
    declare: "var place@N;",
    typedDeclare: "var place@N: number | undefined;",
    read: "place@N",
    write: "place@N = @V;",
  },
  {
    declare: "var place@N;",
    typedDeclare: "var place@N: number | undefined;",
    read: "place@N",
    write: "place@N = @V;",
  },
  {
    declare: "var place@N;",
    typedDeclare: "var place@N: number | undefined;",
    read: "place@N",
    write: "place@N = (place@N ?? 0) + @V;",
  },
  {
    declare: "var place@N;",
    typedDeclare: "var place@N: { a: number } | undefined;",
    read: "place@N?.a",
    write: "place@N = { a: @V };",
  },
  // Bindings of functions that nothing stores to but the generator, behind its yield. The read is a call.
  {
    declare: "function* other@N()@T {\n  yield 100;\n}",
    read: "[...g@N()].join()",
    write: "g@N = other@N;",
    isOwnName: true,
  },
  {
    declare: "function* other@N()@T {\n  yield 100;\n}",
    read: "[...g@N()].join()",
    write: "g@N = other@N;",
    isOwnName: true,
  },
  {
    declare: "function* other@N()@T {\n  yield 100;\n}",
    read: "g@N().next().value",
    write: "g@N = other@N;",
    isOwnName: true,
  },
  { declare: "function first@N() {\n  return 0;\n}\nfunction second@N() {\n  return 1;\n}", read: "first@N()", write: "first@N = second@N;", isOnlyUntyped: true, isStoredToFromOutside: true }, // prettier-ignore
  { declare: "function first@N() {\n  return 0;\n}\nfunction second@N() {\n  return 1;\n}", read: "first@N()", write: "first@N = second@N;", isOnlyUntyped: true, isStoredToFromOutside: true }, // prettier-ignore
  { declare: "let first@N = () => 0;\nconst second@N = () => 1;", read: "first@N()", write: "first@N = second@N;" },
  { declare: "let first@N = () => 0;\nconst second@N = () => 1;", read: "first@N()", write: "first@N = second@N;" },
  { declare: "let Made@N = class {\n  tag() {\n    return 0;\n  }\n};\nconst Other@N = class {\n  tag() {\n    return 1;\n  }\n};", read: "new Made@N().tag()", write: "Made@N = Other@N;" }, // prettier-ignore
  { declare: "let place@N = 0;", reset: "place@N = 0;", read: "place@N", write: "place@N = @V;", isCount: true },
  { declare: "let place@N = 0;", reset: "place@N = 0;", read: "place@N", write: "place@N = @V;", isCount: true },
  { declare: "let place@N = 0;", reset: "place@N = 0;", read: "place@N", write: "place@N += @V;", isCount: true },
  { declare: "let place@N = 0;", reset: "place@N = 0;", read: "place@N", write: "place@N++;", isCount: true },
  { declare: 'let place@N = "";', reset: 'place@N = "";', read: "place@N", write: 'place@N += "w" + @V;' },
  {
    declare: 'let place@N = "";',
    reset: 'place@N = "";',
    read: "place@N.length",
    write: 'place@N += "w";',
    isCount: true,
  },
  {
    declare: "let place@N = null;",
    reset: "place@N = null;",
    read: "(place@N === null ? -1 : place@N.a)",
    write: "place@N = { a: @V };",
    isOnlyUntyped: true,
  },
  { declare: "const holder@N = { value: 0 };", reset: "holder@N.value = 0;", read: "holder@N.value", write: "holder@N.value = @V;", isCount: true }, // prettier-ignore
  { declare: "const holder@N = { value: 0 };", reset: "holder@N.value = 0;", read: "holder@N.value", write: "holder@N.value = @V;", isCount: true }, // prettier-ignore
  { declare: "const holder@N = { inner: { value: 0 } };", reset: "holder@N.inner = { value: 0 };", read: "holder@N.inner.value", write: "holder@N.inner = { value: @V };", isCount: true }, // prettier-ignore
  {
    declare: "const list@N = [0, 0];",
    reset: "list@N[1] = 0;",
    read: "list@N[1]",
    write: "list@N[1] = @V;",
    isCount: true,
  },
  {
    declare: "const list@N = [0, 0];",
    reset: "list@N.length = 2;",
    read: "list@N.length",
    write: "list@N.push(@V);",
    isCount: true,
  },
  {
    declare: "const list@N = [0, 0, 0, 0, 0, 0, 0, 0, 0];",
    reset: "list@N.length = 9;",
    read: "list@N.length",
    write: "list@N.pop();",
  },
  { declare: "let list@N = [0];", reset: "list@N = [0];", read: "list@N[0]", write: "list@N = [@V];", isCount: true },
  {
    declare: "const bytes@N = new Uint8Array(2);",
    reset: "bytes@N[0] = 0;",
    read: "bytes@N[0]",
    write: "bytes@N[0] = @V;",
  },
  {
    declare: 'const map@N = new Map([["key", 0]]);',
    reset: 'map@N.set("key", 0);',
    read: 'map@N.get("key")',
    write: 'map@N.set("key", @V);',
  },
  {
    declare: "const map@N = new Map([[0, 0]]);",
    reset: "map@N.clear();",
    read: "map@N.size",
    write: "map@N.set(@V, @V);",
    isCount: true,
  },
  {
    declare: "const set@N = new Set([0]);",
    reset: "set@N.clear();",
    read: "set@N.size",
    write: "set@N.add(@V);",
    isCount: true,
  },
  {
    declare: 'const set@N = new Set(["other"]);',
    reset: 'set@N.delete("written");',
    read: 'set@N.has("written")',
    write: 'set@N.add("written");',
  },
  {
    declare: "let call@N = () => 0;",
    reset: "call@N = () => 0;",
    read: "call@N()",
    write: "{\n      const kept = @V;\n      call@N = () => kept;\n    }",
    isCount: true,
  },
  {
    declare: "function first@N() {\n  return 0;\n}\nconst kept@N = first@N;\nfunction second@N() {\n  return 1;\n}",
    reset: "first@N = kept@N;",
    read: "first@N()",
    write: "first@N = second@N;",
    isOnlyUntyped: true,
    isStoredToFromOutside: true,
  },
  {
    declare: "class Box@N {\n  static value = 0;\n}",
    reset: "Box@N.value = 0;",
    read: "Box@N.value",
    write: "Box@N.value = @V;",
    isCount: true,
  },
  {
    declare: "const holder@N = { value: 0 };",
    typedDeclare: "const holder@N: { value: number; extra?: number } = { value: 0 };",
    reset: "delete holder@N.extra;",
    read: '("extra" in holder@N)',
    write: "holder@N.extra = @V;",
  },
  {
    declare: "const holder@N = { value: 0 };",
    typedDeclare: "const holder@N: Record<string, number> = { value: 0 };",
    reset: "for (const name of Object.keys(holder@N)) delete holder@N[name];",
    read: "Object.keys(holder@N).length",
    write: 'holder@N["name" + @V] = @V;',
    isCount: true,
  },
  {
    declare: "let holder@N = { value: 0 };",
    reset: "holder@N = { value: 0 };",
    read: "Object.isFrozen(holder@N)",
    write: "Object.freeze(holder@N);",
  },
  {
    declare: "const holder@N = { value: 0 };",
    typedDeclare: "const holder@N: { value: number | string } = { value: 0 };",
    reset: "holder@N.value = 0;",
    read: "typeof holder@N.value",
    write: 'holder@N.value = "text" + @V;',
  },
];

/** The body of `g@N`. `@W` is the write. What it yields are numbers. */
const bodies = [
  "yield 1;\n  @W\n  yield 2;",
  "yield 1;\n  @W\n  yield 2;",
  "@W\n  yield 1;\n  yield 2;",
  "yield 1;\n  yield 2;\n  @W",
  "yield 1;\n  @W\n  yield 2;\n  @W\n  yield 3;",
  "for (let i = 0; i < 4; i++) {\n    yield i;\n    if (i === @K) {\n      @W\n    }\n  }",
  "for (let i = 0; i < 4; i++) {\n    yield i;\n    @W\n  }",
  "for (let i = 0; i < 4; i++) {\n    @W\n    yield i;\n  }",
  "try {\n    yield 1;\n    yield 2;\n  } finally {\n    @W\n  }",
  "try {\n    yield 1;\n    yield 2;\n  } finally {\n    @W\n  }",
  "try {\n    yield 1;\n    yield 2;\n  } catch (error) {\n    @W\n    yield 3;\n  }",
  "yield 1;\n  (() => {\n    @W\n  })();\n  yield 2;",
  "yield 1;\n  writes@N();\n  yield 2;",
  "yield 1;\n  yield* inner@N();\n  yield 2;",
  "yield 1;\n  if (stamp % 2 === 0) {\n    @W\n  }\n  yield 2;",
];

/** Between the two reads. `@G` makes the generator, `@R` is the read, `@M` a read in the middle. They may add to `got`. */
const steps: readonly { text: string; needsCount?: true }[] = [
  { text: "const stepped = @G;\n  stepped.next();\n  @M\n  stepped.next();\n  stepped.next();" },
  { text: "const stepped = @G;\n  stepped.next();\n  @M\n  stepped.next();\n  stepped.next();" },
  { text: "const stepped = @G;\n  stepped.next();\n  stepped.next();" },
  { text: "got += [...@G].join();" },
  { text: "got += [...@G].join();" },
  { text: 'for (const value of @G) got += value + ":" + String(@R) + " ";' },
  { text: "for (const value of @G) got += value;" },
  { text: 'const [one, two] = @G;\n  got += one + "," + two;' },
  { text: "const [one] = @G;\n  got += String(one);" },
  { text: "got += Array.from(@G).join();" },
  { text: "got += drained(@G);" },
  { text: "got += taken(@G, 2);" },
  { text: "got += String(Math.max(...@G));" },
  { text: "got += String(new Set(@G).size);" },
  { text: "got += @G.map(value => value * 2).toArray().join();" },
  { text: "got += @G.take(2).toArray().join();" },
  { text: "@G.forEach(value => {\n    got += value;\n  });" },
  { text: "const stepped = @G;\n  stepped.next();\n  @M\n  stepped.return(undefined);" },
  { text: 'const stepped = @G;\n  stepped.next();\n  @M\n  try {\n    stepped.throw(new RangeError("thrown in"));\n  } catch (error) {\n    got += "threw";\n  }' }, // prettier-ignore
  { text: "for (const value of @G) {\n    got += value;\n    if (value === 1) break;\n  }" },
  { text: "for (let guard = 0, stepped = @G; @R < 1 && guard < 8; guard++) {\n    stepped.next();\n    got += guard;\n  }", needsCount: true }, // prettier-ignore
  { text: "const stepped = @G;\n  while (@R < 1 && !stepped.next().done) got += \".\";", needsCount: true }, // prettier-ignore
];

export function generate(random: Random, typed: boolean): string {
  const pick = <T>(list: readonly T[]) => list[random.below(list.length)];
  const iterator = typed ? ": Generator<number, void, unknown>" : "";
  const scenes: string[] = [];
  let staysInOneFile = false;
  const count = random.between(3, 7);
  for (let scene = 0; scene < count; scene++) {
    const place = pick(places.filter(each => !typed || !each.isOnlyUntyped));
    const reset = place.reset && random.chance(0.5) ? place.reset + "\n  " : "";
    const write = place.write.replaceAll("@V", "++stamp");
    const step = pick(steps.filter(each => !each.needsCount || (place.isCount && reset)));
    const body = pick(bodies)
      .replace("@K", String(random.below(4)))
      .replaceAll("@W", write);
    const isHanded = random.chance(0.2);
    const isInGenerator = !isHanded && random.chance(0.15);
    const isInLine = !isHanded && !isInGenerator && random.chance(0.35);
    const isHeld = place.isOwnName && typed ? true : random.chance(0.25);
    const around = `let got = "";
  let middle = "none";
  ${reset}const before = ${place.read};
  ${step.text
    .replaceAll("@G", isHanded ? "handed" : "g@N()")
    .replaceAll("@M", "middle = String(@R);")
    .replaceAll("@R", place.read)}
  const after = ${place.read};`;
    const told = 'String(before) + "|" + middle + "|" + String(after) + "|" + got';
    const turns = pick([1, 2, 2, 3, 40]);
    // The caller: statements that stand where the scene stands, a generator of its own that steps with \`yield*\`, or a function.
    const caller = isInLine
      ? `{\n  ${around}\n  console.log("scene @N", ${told});\n}\n`.repeat(Math.min(turns, 2)).trimEnd()
      : `${
          isInGenerator
            ? `function* outer@N() {
  ${reset}const before = ${place.read};
  yield* g@N();
  const after = ${place.read};
  yield String(before) + "|" + String(after);
}
function ask@N() {
  return [...outer@N()].join();
}`
            : `function ask@N(${isHanded ? "handed" + iterator : ""}) {
  ${around}
  return ${told};
}`
        }
{
  let said = "";
  for (let turn = 0; turn < ${turns}; turn++) said = ${turns > 3 ? "" : 'said + " / " + '}ask@N(${isHanded ? "g@N()" : ""});
  console.log("scene @N", said);
}`;
    // What the body calls to make the write. It stores to the place from another declaration.
    const helpers =
      (body.includes("writes@N(") ? `function writes@N() {\n  ${write}\n}\n` : "") +
      (body.includes("inner@N(") ? `function* inner@N()${iterator} {\n  yield 10;\n  ${write}\n  yield 11;\n}\n` : "");
    const text = `${(typed && place.typedDeclare) || place.declare}
${helpers}${isHeld ? "let g@N = function* ()" : "function* g@N()"}${iterator} {
  ${body}
}${isHeld ? ";" : ""}
${caller}`
      .replaceAll("@T", iterator)
      .replaceAll("@N", String(scene));
    // In a function the places are variables that the generator captures.
    const isInFunction = random.chance(0.35);
    staysInOneFile ||=
      !isInFunction && (!!place.isStoredToFromOutside || (!!place.isOwnName && !isHeld && helpers !== ""));
    scenes.push(isInFunction ? `function scene${scene}() {\n${text.replace(/^/gm, "  ")}\n}\nscene${scene}();` : text);
  }
  // A program that reads `this` at its top level is not split into several files.
  return `${staysInOneFile ? "const atTheTop = this;\n" : ""}let stamp = 0;
function drained(given${typed ? ": Iterable<number>" : ""}) {
  let text = "";
  for (const value of given) text += value + ";";
  return text;
}
function taken(given${typed ? ": Iterator<number>" : ""}, count${typed ? ": number" : ""}) {
  let text = "";
  for (let at = 0; at < count; at++) text += String(given.next().value) + ";";
  return text;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
