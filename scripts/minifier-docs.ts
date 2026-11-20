// Generates the Output blocks of `docs/bundler/minifier.mdx`.
//
// You write a section's heading, its `**Mode:**` line, its description and its Input by hand. The Mode line is the
// `bun build` flags of the section, each in a code span, or `Always active` for none. This script saves the Input as
// `input.ts`, runs `bun build ./input.ts <flags>` and puts what that prints into the section's Output block:
//
//   bun bd scripts/minifier-docs.ts --write
//
// It builds with the bun that runs it, or with `--bun=<path to bun>`. Without `--write` it lists the sections that
// are out of date and exits with 1.
//
// `test/bundler/minifier-docs.test.ts` fails if an Output block is stale. A change to the minifier that changes what
// a section prints needs `--write` with the new build.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export const pagePath = join(import.meta.dirname, "..", "docs", "bundler", "minifier.mdx");

type Section = {
  title: string;
  /** 1-based line of the `**Mode:**` line. */
  line: number;
  flags: string[];
  /** File name to source. `input.ts` is the entry point. */
  files: Record<string, string>;
  /** The lines of the page that the body of the Output block covers: the first one, and one past the last. */
  output: [start: number, end: number];
};

/** Runs `bun build` with these arguments in `cwd`. */
export type Build = (cwd: string, args: string[]) => Promise<{ exitCode: number; stderr: string }>;

/**
 * `bun build` inlines `process.env.NODE_ENV`, which `bun test` sets, so every caller builds without it. The builds are
 * small and run side by side, so each one gets two threads and not one for each core.
 */
export function buildWith(bun: string, env: Record<string, string | undefined>): Build {
  return async (cwd, args) => {
    await using proc = Bun.spawn({
      cmd: [bun, "build", ...args],
      env: { ...env, NODE_ENV: undefined, BUN_ENV: undefined, NO_COLOR: "1", UV_THREADPOOL_SIZE: "2" },
      cwd,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { exitCode, stderr };
  };
}

// The Mode lines become the argv of a `bun build` that runs in CI, so they can only name the flags listed here.
const FLAG = /^--(?:minify(?:-syntax|-whitespace|-identifiers)?|drop=[A-Za-z_$][\w$]*)$/;
const NO_FLAGS = "Always active";
const ENTRY = "input.ts";
/** Under this heading every `###` heading is a section. */
const EVERY = "## All Transformations";

function flagsOf(mode: string) {
  if (mode === NO_FLAGS) return [];
  const flags = mode.split(" ").map(it => /^`([^`]+)`$/.exec(it)?.[1] ?? "");
  if (flags.every(it => FLAG.test(it)) && new Set(flags).size === flags.length) return flags;
  return undefined;
}

/** Every section that has a `**Mode:**` line. `problems` lists what keeps the page from being generated. */
function sectionsOf(page: string) {
  const lines = page.split("\n");
  const sections: Section[] = [];
  const problems: string[] = [];
  let heading = { text: "", line: 0, needsMode: false };
  let underEvery = false;
  let open: { section: Section; inputs: number; outputs: number; hasFlags: boolean } | undefined;

  const close = () => {
    if (open) {
      const where = `line ${open.section.line}: "${open.section.title}"`;
      if (open.inputs !== 1) problems.push(`${where} has ${open.inputs} \`\`\`ts Input blocks. It needs one.`);
      if (open.outputs !== 1) problems.push(`${where} has ${open.outputs} \`\`\`js Output blocks. It needs one.`);
      if (open.inputs === 1 && open.outputs === 1 && open.hasFlags) sections.push(open.section);
    } else if (heading.needsMode) {
      problems.push(`line ${heading.line}: "${heading.text}" has no **Mode:** line`);
    }
    open = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const at = `line ${i + 1}`;
    const title = /^(#{2,3}) (.+)$/.exec(lines[i]);
    if (title) {
      close();
      if (title[1] === "##") underEvery = lines[i] === EVERY;
      heading = { text: title[2], line: i + 1, needsMode: underEvery && title[1] === "###" };
      continue;
    }

    const mode = /^\*\*Mode:\*\* (.+)$/.exec(lines[i]);
    if (mode) {
      const flags = flagsOf(mode[1]);
      if (open) {
        problems.push(`${at}: "${heading.text}" has a second **Mode:** line`);
        continue;
      }
      if (!flags)
        problems.push(
          `${at}: the Mode of "${heading.text}" has to be \`${NO_FLAGS}\`, or flags from the list in scripts/minifier-docs.ts, each in a code span`,
        );
      const section: Section = { title: heading.text, line: i + 1, flags: flags ?? [], files: {}, output: [0, 0] };
      open = { section, inputs: 0, outputs: 0, hasFlags: flags !== undefined };
      continue;
    }

    const fence = /^```(\w*) ?(.*)$/.exec(lines[i]);
    if (!fence) continue;
    const end = lines.indexOf("```", i + 1);
    if (end < 0) {
      problems.push(`${at}: this code block has no end`);
      break;
    }
    const [, language, name] = fence;
    if (name === "Output") {
      if (!open)
        problems.push(`${at}: no section with a **Mode:** line has this Output block, so nothing generates it`);
      else if (language !== "js") problems.push(`${at}: an Output block is \`\`\`js Output`);
      else if (!open.inputs) problems.push(`${at}: the Output block comes after the Input block`);
      else if (!open.outputs++) open.section.output = [i + 1, end];
    } else if (open) {
      const file = name === "Input" ? ENTRY : name;
      // Lower case, so that two names are two files on every file system.
      if (language !== "ts" || !/^[a-z0-9_-]+\.ts$/.test(file) || name === ENTRY)
        problems.push(`${at}: a code block in a section is \`\`\`ts Input, \`\`\`ts <name>.ts or \`\`\`js Output`);
      else if (file in open.section.files) problems.push(`${at}: the section has two blocks for ${file}`);
      else if (open.outputs) problems.push(`${at}: the Output block is the last block of a section`);
      else {
        open.section.files[file] = lines.slice(i + 1, end).join("\n") + "\n";
        if (file === ENTRY) open.inputs++;
      }
    }
    i = end;
  }
  close();
  if (!lines.includes(EVERY)) problems.push(`the page has no "${EVERY}" heading`);
  return { lines, sections, problems };
}

const keyOf = (flags: string[]) => flags.join(" ");
const without = (flags: string[], flag: string) => flags.filter(it => it !== flag);

/**
 * Builds every section with its flags, and once more without each one of them. That's one `bun build` for each list
 * of flags, whatever the number of sections.
 *
 * `outputs` has each section's Output block. `problems` also lists a flag that changes nothing in its section: the
 * Mode line says the transformation needs that flag, and it doesn't. A flag for whitespace changes almost every
 * Output, so this finds the syntax, identifier and drop flags that a section doesn't need.
 */
async function outputsOf(sections: Section[], dir: string, build: Build) {
  const problems: string[] = [];
  const groups = new Map<string, { flags: string[]; sections: Section[] }>();
  const ask = (section: Section, flags: string[]) => {
    let group = groups.get(keyOf(flags));
    if (!group) groups.set(keyOf(flags), (group = { flags, sections: [] }));
    group.sections.push(section);
  };
  for (const section of sections) {
    ask(section, section.flags);
    for (const flag of section.flags) ask(section, without(section.flags, flag));
  }

  // Nothing above `src` has a say in what Bun prints.
  const source = join(dir, "src");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "package.json"), "{}\n");
  writeFileSync(join(source, "tsconfig.json"), "{}\n");
  // Unless whitespace is minified, Bun writes a comment with the path above the code of each source file, such as
  // `// section-3/input.ts`. No Input has the name of a folder in it, so such a line is never a line of an Input.
  let prefix = "section-";
  while (sections.some(it => Object.values(it.files).some(text => text.includes(prefix)))) prefix += "-";
  const folderOf = (section: Section) => prefix + sections.indexOf(section);
  const sectionIn = new Map(sections.map(it => [folderOf(it), it]));
  for (const section of sections) {
    for (const [name, text] of Object.entries(section.files)) {
      const path = join(source, folderOf(section), name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
  }

  const printed = new Map<string, string>();
  const failed = await Promise.all(
    [...groups.values()].map(async (group, index) => {
      const command = ["bun build", ...group.flags].join(" ");
      const outdir = join(dir, "out", String(index));
      const entries = group.sections.map(it => `./${folderOf(it)}/${ENTRY}`);
      try {
        const built = await build(source, [...entries, ...group.flags, "--root", ".", "--outdir", outdir]);
        if (built.exitCode !== 0) {
          // The path of a file in an error becomes the title of its section.
          const errors = built.stderr.replaceAll(/\S*[\\/]src[\\/]([^\\/\s]+)[\\/]/g, (path, folder) => {
            const section = sectionIn.get(folder);
            return section ? `"${section.title}": ` : path;
          });
          return { command, exitCode: built.exitCode, errors: errors.trim() };
        }
        for (const section of group.sections) {
          const folder = folderOf(section);
          const path = join(outdir, folder, "input.js");
          if (!existsSync(path)) {
            problems.push(`\`${command}\` wrote no file for "${section.title}"`);
            continue;
          }
          const comments = new Set(Object.keys(section.files).map(name => `// ${folder}/${name}`));
          const lines = readFileSync(path, "utf8").split("\n");
          const text = lines.filter(line => !comments.has(line)).join("\n");
          printed.set(`${folder}\0${keyOf(group.flags)}`, text.trimEnd());
        }
        return undefined;
      } catch (error) {
        return { command, exitCode: undefined, errors: String(error) };
      }
    }),
  );
  // A section that doesn't build fails every build it is in, with the same errors.
  const seen = new Set<string>();
  for (const failure of failed) {
    if (!failure || (failure.errors && seen.has(failure.errors))) continue;
    seen.add(failure.errors);
    const code = failure.exitCode === undefined ? "" : ` with exit code ${failure.exitCode}`;
    problems.push(`\`${failure.command}\` failed${code}:\n${failure.errors}`);
  }

  const outputs = new Map<Section, string>();
  for (const section of sections) {
    const under = (flags: string[]) => printed.get(`${folderOf(section)}\0${keyOf(flags)}`);
    const output = under(section.flags);
    if (output === undefined) continue;
    outputs.set(section, output);
    if (output === "") problems.push(`line ${section.line}: "${section.title}" prints nothing`);
    for (const flag of section.flags) {
      if (under(without(section.flags, flag)) === output)
        problems.push(`line ${section.line}: "${section.title}" prints the same without \`${flag}\``);
    }
  }
  return { outputs, problems };
}

/** The page with every Output block as `outputs` has it, and the titles of the sections whose block was different. */
function withOutputs(lines: string[], sections: Section[], outputs: Map<Section, string>) {
  const next = [...lines];
  const stale: string[] = [];
  // From the last section up, so that the line numbers above it stay right.
  for (const section of sections.toReversed()) {
    const output = outputs.get(section);
    if (output === undefined) continue;
    const [start, end] = section.output;
    if (lines.slice(start, end).join("\n") === output) continue;
    stale.unshift(section.title);
    next.splice(start, end - start, ...output.split("\n"));
  }
  return { text: next.join("\n"), stale };
}

/**
 * The page as it should be, the sections whose Output block is stale, and what is wrong with the page. `dir` is an
 * empty folder to build in.
 */
export async function generated(page: string, dir: string, build: Build) {
  const { lines, sections, problems } = sectionsOf(page);
  const { outputs, problems: more } = await outputsOf(sections, dir, build);
  return { ...withOutputs(lines, sections, outputs), sections: sections.length, problems: [...problems, ...more] };
}

if (import.meta.main) {
  const flag = (name: string) => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
  // A build runs in another folder, so a relative path has to be resolved here. A name with no folder is a command.
  const named = flag("bun") ?? process.execPath;
  const bun = /[\\/]/.test(named) ? resolve(named) : (Bun.which(named) ?? named);
  let revision: string;
  try {
    revision = Bun.spawnSync({ cmd: [bun, "--revision"] })
      .stdout.toString()
      .trim();
  } catch (error) {
    console.error(`error: cannot run "${bun}": ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const write = process.argv.includes("--write");
  const before = readFileSync(pagePath, "utf8").replaceAll("\r\n", "\n");
  const dir = mkdtempSync(join(tmpdir(), "bun-minifier-docs-"));
  try {
    const { text, stale, problems } = await generated(before, dir, buildWith(bun, process.env));
    for (const problem of problems) console.error(problem);
    if (write && text !== before) writeFileSync(pagePath, text);
    if (!write) for (const title of stale) console.log(`out of date: ${title}`);
    const page = relative(process.cwd(), pagePath);
    console.log(`${stale.length} Output blocks ${write ? "written" : "out of date"} in ${page} (bun ${revision})`);
    if (problems.length || (stale.length && !write)) process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
