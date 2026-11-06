// A program in one file knows all its declarations at once. `withDeclarationsInFilesOfTheirOwn` lays the functions, classes, enums, namespaces, constants, interfaces and types that a file declares at its top into up
// to four further files, which import from each other what they name, and the file that is left imports from them. A declaration goes behind everything that it names, so the files load in the order in which the
// declarations were written. What stays: statements, variables that can be stored to and whatever names them, what is exported already. A program that asks at its top what `this` is stays in one file. With `namesTheProgram` a function may also name what stays, and its
// file imports the first file of the program again. The program prints what it printed before, unless it asks in which order its declarations and statements run.
import { Random } from "./random";

type Unit = {
  text: string;
  /** `stays`: it is left where it is. `copied`: an import or an ambient declaration, written again in every file that names something of it. */
  kind: "stays" | "copied" | "a type" | "a function" | "a value";
  defines: string[];
  names: Set<string>;
};

/** Stands between the parts of what declares one name in several statements. */
const mark = "\0";
const word = /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy;
const beforeARegExp =
  /(?:^|[-+*/%&|^!~<>=?:;,([{}]|\b(?:return|typeof|case|of|in|do|else|void|delete|throw|new|yield|await))\s*$/;

/** The offsets at which a statement begins at the top of the file, and the names in the text outside texts, comments and members behind a dot. Nothing where the brackets do not add up. */
function scan(text: string): { starts: number[]; names: [at: number, name: string][] } | undefined {
  const starts: number[] = [];
  const names: [number, string][] = [];
  /** For each open bracket, whether it is the `${` of a template. */
  const open: boolean[] = [];
  let at = 0;
  let isTextOpen = false;
  let hasEnded = false;
  /** The last character that is neither space nor part of a comment. */
  let last = "";
  const template = () => {
    while (at < text.length) {
      if (text[at] === "\\") at += 2;
      else if (text[at] === "`") return void at++;
      else if (text.startsWith("${", at)) {
        open.push(true);
        at += 2;
        return;
      } else at++;
    }
    isTextOpen = true;
  };
  while (at < text.length) {
    const char = text[at];
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    // A statement begins at the margin, or further in where the line before it ends in a brace that closes.
    const isAtTheMargin =
      open.length === 0 &&
      (at === 0 || text[at - 1] === "\n" || (last === "}" && /\n[ \t]*$/.test(text.slice(Math.max(0, at - 40), at))));
    if (
      (isAtTheMargin &&
        !/^(?:[)\]}.,?:*/%&|^<>=+`([-]|(?:else|catch|finally|instanceof|in|of|as|satisfies|extends|implements)\b)/.test(
          text.slice(at, at + 12),
        )) ||
      (isAtTheMargin && text.startsWith("//", at)) ||
      (isAtTheMargin && text.startsWith("/*", at)) ||
      // Behind a semicolon at the top of the file the next statement begins, also on the same line.
      hasEnded
    )
      starts.push(at);
    hasEnded = char === ";" && open.length === 0;
    const isComment = text.startsWith("//", at) || text.startsWith("/*", at);
    if (text.startsWith("//", at)) {
      const end = text.indexOf("\n", at);
      at = end < 0 ? text.length : end;
    } else if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      if (end < 0) return;
      at = end + 2;
    } else if (char === '"' || char === "'") {
      for (at++; at < text.length && text[at] !== char; at++) if (text[at] === "\\") at++;
      at++;
    } else if (char === "`") {
      at++;
      template();
    } else if (char === "/" && beforeARegExp.test(text.slice(Math.max(0, at - 12), at))) {
      let isInAClass = false;
      for (at++; at < text.length && (text[at] !== "/" || isInAClass); at++) {
        if (text[at] === "\n") return;
        if (text[at] === "\\") at++;
        else if (text[at] === "[") isInAClass = true;
        else if (text[at] === "]") isInAClass = false;
      }
      at++;
    } else if ("([{".includes(char)) {
      open.push(false);
      at++;
    } else if (")]}".includes(char)) {
      if (!open.length) return;
      at++;
      if (open.pop()) template();
    } else {
      word.lastIndex = at;
      const found = word.exec(text);
      if (found) {
        let before = at - 1;
        while (before >= 0 && /\s/.test(text[before])) before--;
        if (text[before] !== "." || text[before - 1] === ".") names.push([at, found[0]]);
        at += found[0].length;
      } else if (/\d/.test(char)) {
        at += /^(?:0[xob][\da-f_]+n?|[\d_]*\.?[\d_]*(?:e[-+]?\d+)?n?)/i.exec(text.slice(at, at + 400))![0].length || 1;
      } else at++;
    }
    if (!isComment) last = text[at - 1];
  }
  return open.length || isTextOpen ? undefined : { starts, names };
}

/**
 * Whether the text asks at its top what `this` is. A file that imports something is a module, and there the answer is another one. The transpiler knows which `this` stands at the top: it prints something
 * else for it in a module.
 */
function namesThisAtItsTop(text: string, transpiler: Bun.Transpiler): boolean {
  const count = (printed: string) => printed.match(/\bthis\b/g)?.length ?? 0;
  try {
    return (
      count(transpiler.transformSync(`async function all() {\n${text}\n}`)) >
      count(transpiler.transformSync(`export {};\n${text}`))
    );
  } catch {
    return false;
  }
}

/** Whether the text stores to the name somewhere: by an assignment, a step, a pattern at the beginning of a line or the head of a loop. Behind a colon the name is a type. */
function stores(name: string, text: string): boolean {
  const written = name.replaceAll("$", "\\$");
  return new RegExp(
    `(?<![.\\w$]|:\\s*)${written}\\s*(?:(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?![=>])|\\+\\+|--)|(?:\\+\\+|--)\\s*${written}\\b|^\\s*(?:\\[|\\(\\{)[^=\\n]*\\b${written}\\b[^=\\n]*=(?![=>])|\\bfor\\s*\\(\\s*${written}\\s+(?:of|in)\\b`,
    "m",
  ).test(text);
}

export function withDeclarationsInFilesOfTheirOwn(
  text: string,
  extension: string,
  random: Random,
  namesTheProgram = false,
): { text: string; files: Record<string, string> } | undefined {
  const isTyped = extension.includes("ts");
  if (
    text.length > 100_000 ||
    !/^m?[jt]sx?$/.test(extension) ||
    /\brequire\b|\bmodule\.|\bexports\b|\bwith\s*\(|\barguments\.callee\b|\beval\b|\bimport\.meta\b|^#!/m.test(text)
  )
    return;
  const scanned = scan(text);
  if (!scanned || scanned.starts.length < 3) return;
  const transpiler = new Bun.Transpiler({ loader: isTyped ? "ts" : "js" });
  if (namesThisAtItsTop(text, transpiler)) return;
  const { starts } = scanned;
  if (starts[0] !== 0) starts.unshift(0);

  // A comment at the margin belongs to what follows it.
  const units: Unit[] = [];
  let pending = "";
  for (let index = 0; index < starts.length; index++) {
    const from = starts[index];
    const to = starts[index + 1] ?? text.length;
    const part = text.slice(from, to);
    if (/^(?:\/\/[^\n]*\s*|\/\*[^]*?\*\/\s*)$/.test(part)) {
      pending += part;
      continue;
    }
    const names = new Set(scanned.names.filter(([at]) => at >= from && at < to).map(([, name]) => name));
    const head =
      /^(?:(import|export|declare)\b|(?:(interface|type)\s+([\w$]+))|((?:async\s+)?function\b)|((?:abstract\s+)?class|(?:const\s+)?enum|namespace|module|const)\b|(let|var|using|await\s+using)\b)?/.exec(
        part,
      )!;
    let kind: Unit["kind"] = "stays";
    let defines: string[] = [];
    try {
      if (head[1] === "import") {
        kind = /^import\s*["']/.test(part) ? "stays" : "copied";
        defines = [...names].filter(name => !["import", "from", "type", "as", "with"].includes(name));
      } else if (head[1] === "export") defines = [...names];
      else if (head[1] === "declare") {
        const declared =
          /^declare\s+(?:(?:abstract\s+)?class|function|const|let|var|enum|namespace|module|type|interface)\s+([\w$]+)/.exec(
            part,
          );
        if (declared) [kind, defines] = ["copied", [declared[1]]];
      } else if (head[2]) [kind, defines] = ["a type", [head[3]]];
      else if (head[4] || head[5] || head[6]) {
        defines = transpiler.scan(`export ${part}`).exports;
        // An overload has no body and declares its name all the same.
        if (!defines.length && head[4])
          defines = [/function\s*\*?\s*([\w$]+)/.exec(part)?.[1] ?? ""].filter(name => name);
        if (!defines.length && /^(?:const\s+)?enum|^namespace|^module/.test(part))
          defines = [/^(?:const\s+enum|enum|namespace|module)\s+([\w$]+)/.exec(part)?.[1] ?? ""].filter(name => name);
        if (!defines.length) return;
        kind = head[6] ? "stays" : head[4] ? "a function" : "a value";
      }
    } catch {
      return;
    }
    units.push({ text: pending + (part.endsWith("\n") ? part : part.trimEnd() + "\n"), kind, defines, names });
    pending = "";
  }
  if (pending) units.push({ text: pending, kind: "stays", defines: [], names: new Set() });

  // What declares one name in several parts (overloads, an interface beside a class) is one.
  const merged: Unit[] = [];
  for (const unit of units) {
    const earlier =
      unit.kind !== "stays" && unit.kind !== "copied"
        ? merged.find(each => each.kind !== "copied" && each.defines.some(name => unit.defines.includes(name)))
        : undefined;
    if (!earlier) {
      merged.push({ ...unit, names: new Set(unit.names) });
      continue;
    }
    earlier.text += mark + unit.text;
    earlier.defines = [...new Set([...earlier.defines, ...unit.defines])];
    for (const name of unit.names) earlier.names.add(name);
    if (
      earlier.kind === "stays" ||
      unit.kind === "a value" ||
      (unit.kind === "a function" && earlier.kind === "a type")
    )
      earlier.kind = earlier.kind === "stays" ? "stays" : unit.kind;
  }

  const textOfTheOthers = (unit: Unit) =>
    merged
      .filter(each => each !== unit)
      .map(each => each.text)
      .join("");
  // What names something that stays, stays; so does what is stored to.
  const canMove = (unit: Unit) => unit.kind !== "stays" && unit.kind !== "copied";
  for (const unit of merged)
    if (canMove(unit) && unit.kind !== "a type" && unit.defines.some(name => stores(name, textOfTheOthers(unit))))
      unit.kind = "stays";
  const isStoredTo = new Set(
    merged
      .filter(unit => /^(?:\s|\/\/[^\n]*\n|\/\*[^]*?\*\/)*(?:let|var|using|await\s+using|export)\b/.test(unit.text))
      .flatMap(unit => unit.defines),
  );
  for (let hasChanged = true; hasChanged; ) {
    hasChanged = false;
    const staying = new Set(merged.filter(unit => unit.kind === "stays").flatMap(unit => unit.defines));
    for (const unit of merged) {
      if (!canMove(unit)) continue;
      const named = [...unit.names].filter(name => staying.has(name) && !unit.defines.includes(name));
      if (!named.length || (namesTheProgram && unit.kind === "a function" && !named.some(name => isStoredTo.has(name))))
        continue;
      unit.kind = "stays";
      hasChanged = true;
    }
    // A function that names what stays can only be called once the first file has run that far. What is worked out while its own file loads may call it, straight or through other functions, so it stays too.
    const late = new Set<string>();
    for (let hasGrown = true; hasGrown; ) {
      hasGrown = false;
      for (const unit of merged) {
        if (unit.kind !== "a function" || unit.defines.every(name => late.has(name))) continue;
        if (![...unit.names].some(name => (staying.has(name) || late.has(name)) && !unit.defines.includes(name)))
          continue;
        for (const name of unit.defines) late.add(name);
        hasGrown = true;
      }
    }
    for (const unit of merged) {
      if (unit.kind !== "a value" || ![...unit.names].some(name => late.has(name))) continue;
      unit.kind = "stays";
      hasChanged = true;
    }
  }
  const moving = merged.filter(canMove);
  if (moving.length < 2) return;

  // Declarations that name each other in a ring go together. Each goes behind what it names.
  const definer = new Map(moving.flatMap(unit => unit.defines.map(name => [name, unit] as const)));
  const needs = (unit: Unit) =>
    [...unit.names].map(name => definer.get(name)).filter((each): each is Unit => !!each && each !== unit);
  const order: Unit[][] = [];
  const index = new Map<Unit, number>();
  const low = new Map<Unit, number>();
  const stack: Unit[] = [];
  const visit = (unit: Unit) => {
    index.set(unit, index.size);
    low.set(unit, index.get(unit)!);
    stack.push(unit);
    for (const each of needs(unit)) {
      if (!index.has(each)) {
        visit(each);
        low.set(unit, Math.min(low.get(unit)!, low.get(each)!));
      } else if (stack.includes(each)) low.set(unit, Math.min(low.get(unit)!, index.get(each)!));
    }
    if (low.get(unit) !== index.get(unit)) return;
    const ring = stack.splice(stack.indexOf(unit));
    order.push(ring.sort((a, b) => merged.indexOf(a) - merged.indexOf(b)));
  };
  for (const unit of moving) if (!index.has(unit)) visit(unit);

  const count = Math.min(order.length, random.between(1, 4));
  const cuts = random
    .sample(
      Array.from({ length: order.length - 1 }, (_, at) => at + 1),
      count - 1,
    )
    .sort((a, b) => a - b);
  const laid = [0, ...cuts].map((from, at) => order.slice(from, cuts[at] ?? order.length).flat());
  const head = /^\/\/ @ts-nocheck[^\n]*\n/.exec(text)?.[0] ?? "";
  const file = (at: number) => `declared-${at + 1}`;
  const from = (name: string) => `"./${name}${isTyped ? "" : `.${extension}`}"`;
  const staying = merged.filter(unit => unit.kind === "stays");
  const stayingNames = new Map(staying.flatMap(unit => unit.defines.map(name => [name, unit] as const)));
  const wantedOfTheProgram = new Set<string>();
  const importsOf = (own: Unit[], upTo: number) => {
    const named = new Set(own.flatMap(unit => [...unit.names]));
    const copied = merged
      .filter(unit => unit.kind === "copied" && unit.defines.some(name => named.has(name)) && !own.includes(unit))
      .map(unit => unit.text.replaceAll(mark, ""));
    const lines = laid.slice(0, upTo).flatMap((units, at) => {
      const taken = units
        .filter(unit => !own.includes(unit))
        .flatMap(unit => unit.defines.filter(name => named.has(name)).map(name => [name, unit.kind] as const));
      const types = taken.filter(([, kind]) => kind === "a type").map(([name]) => name);
      const values = taken.filter(([, kind]) => kind !== "a type").map(([name]) => name);
      return [
        ...(types.length ? [`import type { ${types.join(", ")} } from ${from(file(at))};\n`] : []),
        ...(values.length ? [`import { ${values.join(", ")} } from ${from(file(at))};\n`] : []),
      ];
    });
    return { copied, lines, named };
  };
  const files: Record<string, string> = {};
  laid.forEach((units, at) => {
    const { copied, lines, named } = importsOf(units, at);
    const ofTheProgram = [...named].filter(
      name => stayingNames.has(name) && !units.some(unit => unit.defines.includes(name)),
    );
    for (const name of ofTheProgram) wantedOfTheProgram.add(name);
    files[`${file(at)}.${extension}`] =
      head +
      copied.join("") +
      lines.join("") +
      (ofTheProgram.length ? `import { ${ofTheProgram.join(", ")} } from ${from("main")};\n` : "") +
      units
        .map(unit =>
          unit.text
            .split(mark)
            .map(part => part.replace(/^((?:\s|\/\/[^\n]*\n|\/\*[^]*?\*\/)*)/, "$1export "))
            .join(""),
        )
        .join("");
  });
  const rest = merged.filter(unit => !canMove(unit));
  const { lines } = importsOf(rest, laid.length);
  const firstStatement = rest.findIndex(
    unit => unit.kind !== "copied" && !/^(?:\s|\/\/[^\n]*\n|\/\*[^]*?\*\/)*$/.test(unit.text),
  );
  const stayed =
    rest
      .slice(0, Math.max(0, firstStatement))
      .map(unit => unit.text.replaceAll(mark, ""))
      .join("") +
    lines.join("") +
    rest
      .slice(Math.max(0, firstStatement))
      .map(unit => unit.text.replaceAll(mark, ""))
      .join("") +
    (wantedOfTheProgram.size ? `\nexport { ${[...wantedOfTheProgram].join(", ")} };\n` : "");
  // What is left may name nothing of what went, and is a module all the same.
  const isModule =
    lines.length > 0 || wantedOfTheProgram.size > 0 || rest.some(unit => /^\s*(?:import|export)\b/m.test(unit.text));
  const left = isModule ? stayed : `${stayed}\nexport {};\n`;
  try {
    for (const each of [left, ...Object.values(files)]) transpiler.transformSync(each);
  } catch {
    return;
  }
  return { text: left, files };
}

/** A program in one file that another generator writes, with its declarations in files of their own; as it is where nothing can be laid elsewhere. */
export function apart(
  generate: (random: Random, isTyped: boolean) => string | { text: string },
  random: Random,
): { file: string; text: string; files: Record<string, string> } {
  const seed = random.next();
  const whole = generate(new Random(seed), true);
  const text = typeof whole === "string" ? whole : whole.text;
  let extension = "mjs";
  try {
    new Bun.Transpiler({ loader: "js" }).transformSync(text);
  } catch {
    extension = "ts";
  }
  const laid = withDeclarationsInFilesOfTheirOwn(text, extension, new Random(seed), seed % 2 === 0);
  return { file: `main.${extension}`, text: laid?.text ?? text, files: laid?.files ?? {} };
}
