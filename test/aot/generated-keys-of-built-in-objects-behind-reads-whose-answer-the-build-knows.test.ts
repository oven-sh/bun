// Reads whose answer the build knows: `typeof process.versions`, `process.isBun == null`, `process.release.name === "node"`. Some built-in objects add a member to their own
// properties where it is first read, so such a read shows in the order of their keys once the object was copied, whatever becomes of its value. A program makes one such read, takes
// another member of the same object ahead of it or behind it, copies the object and lists its keys.
// Two names of one object are two members: `Bun.postgres` and `Bun.sql`, `Temporal.Instant` and the `constructor` of its prototype. A read adds the one that it names.
import { generated } from "./generated/run-generated";

const tail = `console.log(Object.keys({ ...listed }).length);\nconsole.log(Reflect.ownKeys(listed).map(String).join());`;

const forms: Record<string, (member: string) => string> = {
  "typeof": member => `console.log(typeof process.${member});`,
  "void": member => `console.log(void process.${member});`,
  "statement": member => `process.${member};`,
  "not": member => `console.log(!process.${member});`,
  "test": member => `if (process.${member}) console.log("yes");`,
  "choice": member => `console.log(process.${member} ? 1 : 2);`,
  "nullish": member => `console.log(process.${member} == null);`,
  "undefined": member => `console.log(process.${member} !== undefined);`,
  "coalesce": member => `console.log(typeof (process.${member} ?? 1));`,
  "and": member => `process.${member} && console.log("yes");`,
  "chain": member => `console.log(typeof process?.${member});`,
  "bracket": member => `console.log(typeof process["${member}"]);`,
  "global": member => `console.log(typeof globalThis.process.${member});`,
  "compared": member => `if (typeof process.${member} === "object") console.log("object");`,
  "in": member => `console.log("${member}" in process);`,
  "const": member => `const known = process.${member}; console.log(typeof known);`,
  "pattern": member => `const { ${member}: known } = process; console.log(typeof known);`,
  "comma": member => `console.log((process.${member}, 1));`,
  "cast": member => `console.log(typeof (process.${member} as unknown));`,
  "template": member => "console.log(`${typeof process." + member + "}`);",
  "template-compared": member => "console.log(`a ${typeof process." + member + "} b` === 'a');",
};

const programs: Record<string, { file?: string; lines: string[] }> = {};
const P = `const listed = process; const held = [];`;
const other = `held.push(process.cwd);`;
for (const member of ["versions", "release", "isBun"]) {
  for (const [form, write] of Object.entries(forms)) {
    const isAhead = (member.length + form.length) % 2 === 0;
    programs[`${member}-${form}`] = {
      file: form === "cast" ? "main.ts" : "main.mjs",
      lines: isAhead ? [P, write(member), other] : [P, other, write(member), `held.push(process.hrtime);`],
    };
  }
  programs[`${member}-in-a-function`] = {
    lines: [P, `function ask() { return typeof process.${member}; }`, other, `console.log(ask());`],
  };
  programs[`${member}-in-a-function-nobody-calls`] = {
    lines: [P, `function ask() { return typeof process.${member}; }`, other, `if (Date.now() < 5) console.log(ask());`],
  };
  programs[`${member}-twice`] = {
    lines: [P, `console.log(typeof process.${member});`, other, `console.log(typeof process.${member});`],
  };
  programs[`${member}-where-nothing-is-copied`] = {
    lines: [`const listed = { ...[process][0] }; const held = [];`, `console.log(typeof process.${member});`, other],
  };
}
const deeper: Record<string, string> = {
  "versions-bun": `console.log(typeof process.versions.bun);`,
  "versions-bun-compared": `console.log(process.versions.bun === "0");`,
  "versions-node-test": `if (process.versions.node) console.log("yes");`,
  "versions-node-chain": `console.log(typeof process?.versions?.node);`,
  "bun-in-versions": `console.log("bun" in process.versions);`,
  "release-name": `console.log(process.release.name === "node");`,
  "release-name-switch": `switch (process.release.name) { case "node": console.log("node"); break; default: console.log("other"); }`,
  "which-runtime": `const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null; console.log(isNode);`,
  "which-runtime-in-a-const": `const isBun = typeof process !== "undefined" && "bun" in process.versions; function open() { return isBun ? 1 : 2; } console.log(open());`,
  "both": `console.log(typeof process.release, typeof process.versions);`,
  "both-in-a-template": "console.log(`${typeof process.release}-${typeof process.versions}`);",
  "imported": `import imported from "node:process"; console.log(typeof imported.versions);`,
};
for (const [name, line] of Object.entries(deeper))
  programs[name] = { lines: [P, other, line, `held.push(process.hrtime);`] };

programs["create-in-a-template"] = {
  lines: [
    `const listed = Object; const held = [Object.keys];`,
    "console.log(`${typeof Object.create}`);",
    `held.push(Object.freeze);`,
  ],
};

const B = `const listed = Bun; const held = [];`;
for (const [name, line] of Object.entries({
  "postgres-typeof": `console.log(typeof Bun.postgres);`,
  "postgres-taken": `held.push(Bun.postgres);`,
  "postgres-then-sql": `held.push(Bun.postgres); held.push(Bun.nanoseconds); held.push(Bun.sql); console.log(held[0] === held[2]);`,
  "sql-then-postgres": `held.push(Bun.sql); held.push(Bun.nanoseconds); held.push(Bun.postgres); console.log(held[0] === held[2]);`,
  "sql-alone": `held.push(Bun.sql);`,
  "postgres-pattern": `const { postgres } = Bun; console.log(typeof postgres);`,
}))
  programs[name] = { lines: [B, `held.push(Bun.which);`, line, `held.push(Bun.sleep);`] };

const constructors: Record<string, [holder: string, made: string, named: string]> = {
  "instant": ["Temporal", "Temporal.Now.instant()", "Temporal.Duration"],
  "plain-date": ["Temporal", "Temporal.Now.plainDateISO()", "Temporal.Duration"],
  "zoned": ["Temporal", "Temporal.Now.zonedDateTimeISO()", "Temporal.Instant"],
  "instant-of-a-date": ["Temporal", "new Date(5).toTemporalInstant()", "Temporal.Duration"],
  "collator": ["Intl", "new Intl.Collator()", "Intl.Locale"],
  "glob": ["Bun", `new Bun.Glob("*")`, "Bun.which"],
  "memory": ["WebAssembly", "new WebAssembly.Memory({ initial: 1 })", "WebAssembly.Table"],
};
for (const [name, [holder, made, named]] of Object.entries(constructors)) {
  programs[`constructor-of-${name}`] = {
    lines: [
      `const listed = ${holder}; const held = [];`,
      `if (typeof ${holder} === "object") {`,
      `const made = ${made};`,
      `held.push(${named});`,
      `console.log(typeof made.constructor, typeof Object.getPrototypeOf(made).constructor);`,
      `}`,
    ],
  };
}

// Every run takes these, whatever else it takes.
const onceWrong = [
  "versions-typeof",
  "versions-void",
  "versions-not",
  "versions-test",
  "versions-nullish",
  "versions-chain",
  "versions-bracket",
  "versions-global",
  "release-typeof",
  "release-and",
  "isBun-nullish",
  "isBun-compared",
  "versions-node-chain",
  "release-name",
  "postgres-typeof",
  "postgres-taken",
  "versions-template",
  "isBun-template",
  "both-in-a-template",
  "create-in-a-template",
];

generated(
  "the keys of a built-in object stand in the order of plain Bun behind reads whose answer the build knows",
  Object.entries(programs).map(([name, { file, lines }], index) => ({
    name: `${name}.`,
    isAlwaysRun: index % 4 === 0,
    wasOnceWrong: onceWrong.includes(name),
    isOnlyCompiled: true as const,
    flags: index % 3 === 2 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({ file: file ?? "main.mjs", text: [...lines, tail].join("\n") + "\n" }),
  })),
);
