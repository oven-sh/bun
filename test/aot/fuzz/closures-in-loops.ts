// Loops with per-iteration bindings, and closures created in every part of them (head, test, update, body, nested
// blocks ..): each closure keeps the bindings of the iteration that created it.
import type { Random } from "./random";

const head = `const lines = [];
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function report(label, made) {
  const call = each => {
    try {
      return each();
    } catch (error) {
      return "THROWS " + error.constructor.name;
    }
  };
  note(label, made.length, made.map(call), made.slice().reverse().map(call));
}
`;

export function generate(random: Random): string {
  let count = 0;
  const rows: string[] = [];
  for (let id = 0, scenes = random.between(4, 9); id < scenes; id++) {
    const kind = random.pick(["function", "function", "function", "generator", "async function"] as const);
    const pause = () => (kind === "generator" ? "yield 0;" : kind === "async function" ? "await null;" : "");
    /** A closure over the names that reads or changes them. */
    const closure = (names: string[]): string => {
      const name = random.pick(names);
      return random.weighted([
        [6, `() => [${names.join(", ")}]`],
        [2, `() => ${name}`],
        [2, `() => ${name}++`],
        [1, `() => (${name} += 10)`],
        [1, `function () {\nreturn ${name};\n}`],
        [1, `() => () => ${name}`],
        [1, `() => typeof ${name}`],
      ]);
    };
    const push = (names: string[]) => `made.push(${closure(names)})`;
    const declares = random.pick(["let", "let", "let", "var"]);
    const body = (names: string[], depth: number): string => {
      const own = `b${count++}`;
      const all = [...names, own];
      const parts = [`${random.pick(["let", "const", "var"]).replace("const", "let")} ${own} = ${names[0]} * 2;`];
      for (let left = random.between(1, 4); left > 0; left--)
        parts.push(
          random.weighted<() => string>([
            [5, () => `${push(all)};`],
            [2, () => `${random.pick(all)}++;`],
            [1, () => pause()],
            [1, () => `if (made.length) made[${random.pick(["0", "made.length - 1"])}]();`],
            [2, () => `if (${names[0]} === 1) continue;`],
            [1, () => `if (${names[0]} === 2) break;`],
            [1, () => `{\nlet ${own} = "inner";\n${push(all)};\n}`],
            [
              1,
              () =>
                `switch (${names[0]}) {\ncase 0:\nlet inSwitch${count} = "zero";\n${push([...all, `inSwitch${count}`])};\nbreak;\ndefault:\n${push(all)};\n}`,
            ],
            [
              1,
              () =>
                `try {\nif (${names[0]} === 1) throw ${names[0]};\n${push(all)};\n} catch (caught) {\n${push([...all, "caught"])};\n} finally {\n${push(all)};\n}`,
            ],
            [depth > 0 ? 2 : 0, () => loop(depth - 1, all)],
          ])(),
        );
      return parts.join("\n");
    };
    const loop = (depth: number, around: string[]): string => {
      const i = `i${count++}`;
      const j = `j${count++}`;
      const names = [i, ...random.sample(around, Math.min(around.length, 1))];
      return random.weighted<() => string>([
        [4, () => `for (${declares} ${i} = 0; ${i} < 3; ${i}++) {\n${body(names, depth)}\n}`],
        [
          2,
          () =>
            `for (${declares} ${i} = 0, first${i} = ${closure([i])}; ${i} < 3; ${i}++) {\nif (${i} === 0) made.push(first${i});\n${body(names, depth)}\n}`,
        ],
        [2, () => `for (${declares} ${i} = 0; ${push([i])}, ${i} < 3; ${i}++) {\n${body(names, depth)}\n}`],
        [2, () => `for (${declares} ${i} = 0; ${i} < 3; ${push([i])}, ${i}++) {\n${body(names, depth)}\n}`],
        [1, () => `for (${declares} ${i} = 0; ${i} < 3; ${i}++, ${push([i])}) {\n${body(names, depth)}\n}`],
        [2, () => `for (${declares} ${i} = 0, ${j} = 10; ${i} < 3; ${i}++, ${j}--) {\n${body([i, j], depth)}\n}`],
        [
          2,
          () =>
            `for (${random.pick(["let", "const", "var"])} ${i} of [0, 1, 2]) {\n${body(names, depth).replaceAll(`${i}++;`, "").replaceAll(`${i}++`, i).replaceAll(`(${i} += 10)`, i)}\n}`,
        ],
        [
          1,
          () =>
            `for (let [${i}, ${j} = ${closure([i])}] of [[0], [1], [2, 5]]) {\nmade.push(() => typeof ${j});\n${body([i], depth)}\n}`,
        ],
        [
          1,
          () =>
            `for (let { ${i}, ${j} = ${i} + 1 } of [{ ${i}: 0 }, { ${i}: 1, ${j}: 7 }]) {\n${body([i, j], depth)}\n}`,
        ],
        [
          1,
          () =>
            `for (${random.pick(["let", "const", "var"])} key${i} in { a: 1, b: 2 }) {\nlet ${i} = key${i}.length;\nmade.push(() => key${i});\n${body([i], depth)}\n}`,
        ],
        [1, () => `let ${i} = -1;\nwhile (++${i} < 3) {\n${body(names, depth)}\n}`],
        [
          1,
          () =>
            `let ${i} = 0;\ndo {\n${body(names, depth).replaceAll("continue;", `{\n${i}++;\ncontinue;\n}`)}\n${i}++;\n} while (${i} < 3);`,
        ],
        [
          1,
          () =>
            `outer${i}: for (let ${i} = 0; ${i} < 3; ${i}++) {\nfor (let ${j} = 0; ${j} < 2; ${j}++) {\n${push([i, j])};\nif (${j} === ${i}) continue outer${i};\n${push([i, j])};\n}\n}`,
        ],
      ])();
    };
    const text = loop(1, ["outside"]);
    const opening =
      kind === "generator"
        ? `function* scene${id}(made)`
        : kind === "async function"
          ? `async function scene${id}(made)`
          : `function scene${id}(made)`;
    rows.push(
      `${opening} {\nlet outside = 100;\n${text}\noutside = "behind the loop";\nreturn made;\n}`,
      `{\nconst made = [];\ntry {\n${kind === "generator" ? `for (const step of scene${id}(made));` : kind === "async function" ? `await scene${id}(made);` : `scene${id}(made);`}\n} catch (error) {\nnote("THROWS", error.constructor.name);\n}\nreport("scene ${id}", made);\nreport("scene ${id} again", made);\n}`,
    );
  }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`;
}
