// Rewrites the lines of a generated program that print a variable, so that no object of the program reaches `console.log`.
// The compiler follows an object for as long as it sees everything that is done to it. `console.log(object)` ends that, and a generated program prints each of its variables.

/** Numbers in [0, 1) that depend on `seed` alone. */
export function randomFrom(seed: string) {
  let state = Bun.hash.crc32(seed) | 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * `text` with one of its scenes and without the others. A scene is a block without indentation: it declares functions and calls them.
 * What the compiler makes of one function depends on what else the program holds.
 */
export function keepOneScene(text: string) {
  const [program, ...otherFiles] = text.split(/^(?=\/\/ @filename: )/m);
  const lines = program.split("\n");
  const scenes: [number, number][] = [];
  for (let first = lines.indexOf("{"); first >= 0; first = lines.indexOf("{", first + 1)) {
    const last = lines.indexOf("}", first);
    if (last < 0) break;
    scenes.push([first, last]);
    first = last;
  }
  if (scenes.length < 2) return text;
  const kept = scenes[Math.floor(randomFrom("scene" + text)() * scenes.length)];
  const isDropped = (index: number) => scenes.some(scene => scene !== kept && index >= scene[0] && index <= scene[1]);
  return lines.filter((_, index) => !isDropped(index)).join("\n") + otherFiles.join("");
}

/** Expressions that end a function with an error that no `throw` statement raises. */
const expressionsThatThrow = [
  "nameThatNothingDeclares",
  "{ next: nameThatNothingDeclares }",
  "(void 0)()",
  "null.member",
  "1n + 1",
  "new (void 0)()",
  "Symbol() + 1",
  "[].reduce(() => 0)",
  "new Array(-1)",
  "BigInt(1.5)",
  'JSON.parse("{")',
  "({}) instanceof 1",
  '"member" in 1',
  "structuredClone(() => 0)",
];

/**
 * `text` with some of its functions that count their calls ending in an error of the engine: `++v1;` is their first statement, and what they return is replaced.
 * Such a function is one that a built-in calls, so the error passes through the built-in to the `try` around it.
 */
export function endHooksInErrors(text: string, isTypeScript: boolean) {
  const random = randomFrom("hooks" + text);
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const indent = /^( +)\+\+\(?v\d+(?: as any\))?;$/.exec(lines[index])?.[1];
    if (indent === undefined || !/\bfunction\b.*\{$/.test(lines[index - 1] ?? "") || random() > 0.4) continue;
    const returns = lines.findIndex(
      (line, other) => other > index && (line.startsWith(indent + "return ") || line.search(/\S/) < indent.length),
    );
    if (returns < 0 || !lines[returns].startsWith(indent + "return ") || !lines[returns].endsWith(";")) continue;
    const expression = expressionsThatThrow[Math.floor(random() * expressionsThatThrow.length)];
    lines[returns] = `${isTypeScript ? indent + "// @ts-ignore\n" : ""}${indent}return ${expression};`;
  }
  return lines.join("\n");
}

const printsAVariable = /^printValue\("([\w$]+)", \1\);$/;
// What these hold differs between an executable and `bun run`, and the driver sets a program aside that names one.
const namesNeverRead = new Set(["stack", "message", "raw", "caller", "argv", "callee", "arguments"]);
const helper = "primitiveOrKind";

/** The members that `text` reads, stores or declares: of `variable`, or of anything. */
function membersNamedIn(lines: string[], variable?: string) {
  const members = new Set<string>();
  const add = (name: string) => void (namesNeverRead.has(name) || members.add(name));
  if (variable === undefined) {
    for (const line of lines) {
      for (const [, name] of line.matchAll(/\.([A-Za-z_$][\w$]*)/g)) add(name);
      for (const [, name] of line.matchAll(/(?:^\s*|[{,] )(?:static |readonly )*([A-Za-z_$][\w$]*)\??(?=: )/g))
        add(name);
    }
    // A variable of the generator is a letter and a number.
    return [...members].filter(name => !/^[A-Za-z]\d+$/.test(name) && name !== "default" && name !== "case");
  }
  const escaped = variable.replaceAll("$", "\\$");
  const ofVariable = new RegExp(`(?<![\\w$.])\\(?${escaped}(?: as any\\))?\\??\\.([A-Za-z_$][\\w$]*)`, "g");
  const declares = new RegExp(`^(?:const|let|var|class|function) ${escaped}\\b.*\\{$`);
  let insideDeclaration = false;
  for (const line of lines) {
    for (const [, name] of line.matchAll(ofVariable)) add(name);
    if (insideDeclaration && /^\}/.test(line)) insideDeclaration = false;
    if (insideDeclaration) {
      const name =
        /^ {4}(?:static |readonly |get |set |async )*([A-Za-z_$][\w$]*)\??(?:: |\(| = |;)/.exec(line)?.[1] ??
        /^ {8}(?:try \{ )?\(?this(?: as any\))?\.([A-Za-z_$][\w$]*) = /.exec(line)?.[1];
      if (name && name !== "constructor") add(name);
    }
    if (declares.test(line)) insideDeclaration = true;
  }
  return [...members];
}

/**
 * `text` with `printValue("v1", v1)` replaced: a primitive is printed as it is and an object as `typeof` says, and behind that some members of the object, read by name.
 * How many members, and of how many variables, is drawn from the text.
 */
export function printMembersOfObjects(text: string, isTypeScript: boolean) {
  const [program, ...otherFiles] = text.split(/^(?=\/\/ @filename: )/m);
  const lines = program.split("\n");
  if (!lines.some(line => printsAVariable.test(line)) || program.includes(helper)) return text;
  const random = randomFrom(text);
  const below = (bound: number) => Math.floor(random() * bound);
  const everyMember = membersNamedIn(lines);
  // 0: no member. 1: one member of one variable. 2: one member of each. 3: up to three of each, its keys and its length.
  const style = below(4);
  const variables = [...new Set(lines.map(line => printsAVariable.exec(line)?.[1]).filter(name => name !== undefined))];
  const theOne = variables[below(variables.length)];
  const castsToAny = isTypeScript && random() < 0.5;
  const wrapsWhatScenesPrint = random() < 0.7;
  const membersOf = new Map<string, string[]>();
  for (const variable of variables) {
    if (style === 0 || (style === 1 && variable !== theOne)) continue;
    const own = membersNamedIn(lines, variable);
    const drawn = new Set<string>();
    for (let count = style === 3 ? 1 + below(3) : 1; count > 0; count--) {
      const from = own.length && random() < 0.8 ? own : everyMember;
      if (from.length) drawn.add(from[below(from.length)]);
    }
    membersOf.set(variable, [...drawn]);
  }
  const ignore = isTypeScript ? ["// @ts-ignore"] : [];
  const guarded = (label: string, value: string) => [
    ...ignore,
    `try { printValue("${label}", ${value}); } catch { printValue("${label} threw"); }`,
  ];
  const rewritten = lines.flatMap(line => {
    if (line === "const printValue = console.log;")
      return [
        line,
        isTypeScript
          ? `function ${helper}(value: unknown): unknown { return (typeof value === "object" && value !== null) || typeof value === "function" ? typeof value : value; }`
          : `function ${helper}(value) { return (typeof value === "object" && value !== null) || typeof value === "function" ? typeof value : value; }`,
      ];
    const variable = printsAVariable.exec(line)?.[1];
    // A scene prints under a label of its own: `printValue("before and after", v1, v2.b);`.
    const [, start, values] = /^(\s+printValue\("[^"]*"), ([^"'`]+)\);$/.exec(line) ?? [];
    if (values !== undefined && wrapsWhatScenesPrint) {
      const pieces: string[] = [];
      let depth = 0;
      for (const piece of values.split(", ")) {
        if (depth > 0) pieces[pieces.length - 1] += ", " + piece;
        else pieces.push(piece);
        for (const character of piece) depth += "([{".includes(character) ? 1 : ")]}".includes(character) ? -1 : 0;
      }
      if (depth === 0)
        return [
          `${start}, ${pieces.map(piece => (piece.startsWith("typeof ") ? piece : `${helper}(${piece})`)).join(", ")});`,
        ];
    }
    if (variable === undefined)
      return style % 2
        ? [line.replace(/^(\s+if \(notes\+\+ < 80\) console\.log\("noted", .* : )value\);$/, `$1${helper}(value));`)]
        : [line];
    const object = castsToAny ? `(${variable} as any)` : variable;
    return [
      `printValue("${variable}", ${helper}(${variable}));`,
      ...(membersOf.get(variable) ?? []).flatMap(member =>
        guarded(`${variable}.${member}`, `${helper}(${object}?.${member})`),
      ),
      ...(style === 3 && random() < 0.4 ? guarded(`${variable} keys`, `Object.keys(${object}).join()`) : []),
      ...(style === 3 && random() < 0.3 ? guarded(`${variable}.length`, `${helper}(${object}?.length)`) : []),
    ];
  });
  return rewritten.join("\n") + otherFiles.join("");
}
