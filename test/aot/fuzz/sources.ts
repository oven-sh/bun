// Where programs come from. A source turns a seed into a program for a bed, or into nothing when the seed gives none.
//
//   mutation    a program of ../programs with something done to it (mutate.ts)
//   grammar     a program built from a pool of language features (grammar.ts)
//   protocols   a protocol, a holder, a way to escape and a time, crossed (protocols.ts)
//   new-targets a base constructor, a way another new.target reaches it, what it does with `this`, crossed (new-targets.ts)
//   object-mutations a kind of object, a change of it, when and where the change runs, how the object is looked at, crossed (object-mutations.ts)
//   typed-object-mutations the same in TypeScript that the checker accepts: the object is looked at through a reference of a declared type (typed-object-mutations.ts)
//   changing-buffers a typed array, a DataView or a Buffer whose memory is detached, shrinks, grows or moves while something reads or writes through it (changing-buffers.ts)
//   many-live-values functions with much control flow and many values of several kinds alive at once (many-live-values.ts)
//   a-throw-at-every-call the same, and each function runs again while its first, second, third .. call that the compiler cannot look through throws (a-throw-at-every-call.ts)
//   values-across-joins values of every width and kind that many paths hand on to one place, behind calls, throws and waits (values-across-joins.ts)
//   operators-at-the-edges small functions of a few operators over integers of 32 bits, wider ones and doubles, run at the ends of their ranges (operators-at-the-edges.ts)
//   objects-across-awaits many async functions in flight at once, each with fresh objects that nothing holds but the function while it waits (objects-across-awaits.ts)
//   every-kind-of-job handlers of promises, async functions, async generators, microtasks and timers, each with fresh objects that nothing else holds, running long beside a large heap (every-kind-of-job.ts)
//   work-on-the-way-up recursion of every kind to the end of the stack, caught at every depth on the way up, with calls into the library and allocation in each catch and finally (work-on-the-way-up.ts)
//   when-the-heap-is-full objects of every kind kept alive until no more fit, the error caught at every level on the way up, a little given back and work done there (when-the-heap-is-full.ts)
//   held-by-one-thing-alone an object that one thing alone holds, a collection, and weak references and a finalizer that tell whether the collector saw that one thing (held-by-one-thing-alone.ts)
//   errors-nobody-catches errors and rejections of every kind that nobody catches, one after the other, heard by the handlers of the process or by nobody, and work behind each (errors-nobody-catches.ts)
//   shapes-that-die-and-come-again the same places in the code see objects of shapes that are made, die in a collection and are made again a little differently (shapes-that-die-and-come-again.ts)
//   workers-ended-in-the-middle a Worker that is busy without end in compiled code is ended from outside, or ends itself from deep inside; needs --batch 1 (workers-ended-in-the-middle.ts)
//   calls-with-very-many-arguments calls whose arguments are counted at run time, from none to more than any stack holds, at the top of the stack and at every level on the way up from its end (calls-with-very-many-arguments.ts)
//   text-beside-compiled-code text that becomes code at run time reads and changes objects that compiled code made, and makes objects for compiled code (text-beside-compiled-code.ts)
//   unsound-types a hole of TypeScript's type system that needs no cast, a type, a value that arrives, a place, a time and uses, drawn at random (unsound-types.ts)
//   typed-instances-changed-through-built-ins an instance of a typed class, and one way in which a built-in, a protocol or a callback changes it or makes another object that passes for one (typed-instances-changed-through-built-ins.ts)
//   several-changes-one-behind-the-other two to four points of object-mutations on one object, in a drawn order, and two looks at what is left (several-changes-one-behind-the-other.ts)
//   objects-with-very-many-fields objects with thirty to three hundred members, read by name, key and symbol, directly and from below through a chain of prototypes, around a change (objects-with-very-many-fields.ts)
//   one-name-for-many-kinds-of-things a name that holds something that can be called, a record without a class and a thing with a fast form, used by element, name, call and walk (one-name-for-many-kinds-of-things.ts)
//   objects-that-the-host-keeps-and-hands-back an object handed to a timer, a promise, an event, a signal, a stream, a socket or a file, changed turns of the event loop later, and read again by its maker (objects-that-the-host-keeps-and-hands-back.ts)
//   one-key-asked-in-every-way a key and a value of every kind, asked by a read, `in`, Object.hasOwn, stores, a delete, a call and patterns, one behind the other (one-key-asked-in-every-way.ts)
//   bodies-in-every-encoding-read-as-json bytes that are JSON, nearly JSON or no UTF-8, held by a Request, a Response, a Blob or a stream, read by json() into declared types, into unknown, and by hand (bodies-in-every-encoding-read-as-json.ts)
//   closures-read-through-array-methods closures over the variables of one turn of a loop or of an array method, read through array methods that follow one another (closures-read-through-array-methods.ts)
//   objects-that-live-for-one-turn-of-a-loop objects, lists, instances, closures and shared variables made anew in each turn and used inside the function that makes them (objects-that-live-for-one-turn-of-a-loop.ts)
//   every-birth-and-use the programs of ../generated/births-and-uses, of which the tests run one in forty: all of them, one after the other
//   programs-as-they-are the programs of ../programs unchanged, one after the other: for lanes that change what is built beside a program (--company) or how it is built (--lowered-limits)
//   several-changes-behind-a-declared-type the same out of typed-object-mutations, looked at through the typed reference (several-changes-behind-a-declared-type.ts)
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { staysAScript, type Bed, type Program } from "./beds";
import { erased, mutate, reprinted } from "./mutate";
import { Random } from "./random";

export interface Generated extends Program {
  source: string;
  seed: number;
  /** Where it comes from and what was done to it. */
  notes: string;
  /** The program a mutant was made from: if that one differs already, the mutant says nothing. */
  base?: Program & { name: string };
  /** What the program is about. Two programs of different groups that fail with the same words are two findings. */
  group?: string;
  /** Its cases, each as a program of its own that prints the lines it prints in the whole: a finding is cut down to one of them first. */
  alone?: string[];
  /** TypeScript's own checker has to accept it, or it does not count. */
  isForTypeScript?: true;
}

export type Source = (seed: number, bed: Bed) => Generated | undefined;

/** The programs in a single file that print the same compiled and plain, with nothing stored beside them. */
function singleFilePrograms(root: string): string[] {
  const found: string[] = [];
  const visit = (folder: string) => {
    const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (entries.some(entry => entry.isFile() && entry.name.startsWith("main."))) return;
    const names = new Set(entries.map(entry => entry.name));
    for (const entry of entries) {
      if (entry.isDirectory()) entry.name === "ways-into-library-modules" || visit(join(folder, entry.name));
      else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const stem = entry.name.replace(/\.\w+$/, "");
        if (![".json", ".expected.txt", ".erased.txt", ".build-errors.txt", ".todo.txt"].some(suffix => names.has(stem + suffix))) found.push(join(folder, entry.name));
      }
    }
  };
  if (existsSync(root)) visit(root);
  return found;
}

// Depends on where the file lies, on the clock or on chance, or prints what differs by design (positions, source text).
const cannotStandAlone = /from "\.|require\("\.|import\("\.|import\.meta|__dirname|__filename|process\.argv|\bprocess\b.*\bconsole\.log\(process\)|Bun\.main|\.stack\b|Date\.now|performance\.now|Math\.random|new Date\(\)|\.toString\(\)\.length|\.caller\b|getBuiltinModule|mkdtemp|hrtime|[cC]puUsage|memoryUsage|resourceUsage|randomUUID|randomBytes|getRandomValues|port: 0|listen\(0/;

function mutation(root: string, rejected: Set<string>): Source | undefined {
  const files = singleFilePrograms(root);
  if (!files.length) return;
  const printed = new Map<string, string | undefined>();
  // The program as it is (typed), or erased to JavaScript and printed one statement per line.
  const baseText = (path: string, typed: boolean) => {
    const key = `${path} ${typed}`;
    if (printed.has(key)) return printed.get(key);
    let text: string | undefined = readFileSync(path, "utf8");
    if (text.length > 12_000 || cannotStandAlone.test(text)) text = undefined;
    try {
      if (text !== undefined && !typed) text = erased(text, path.endsWith(".ts") ? "ts" : "js");
      // The transpiler lowers some syntax to helpers of Bun's own runtime module, which no program imports by hand.
      if (text?.includes('from "bun:wrap"')) text = undefined;
    } catch {
      text = undefined;
    }
    printed.set(key, text);
    return text;
  };
  return (seed, bed) => {
    const random = new Random(seed);
    for (let attempt = 0; attempt < 40; attempt++) {
      const path = random.pick(files);
      const typed = path.endsWith(".ts") && bed.name === "product" && random.chance(0.5);
      const name = `${bed.name} ${relative(root, path)}${typed ? "" : " erased"}`;
      if (rejected.has(name)) continue;
      const base = baseText(path, typed);
      const extension = typed ? "ts" : "js";
      if (base === undefined || !bed.accepts({ text: base, extension })) {
        rejected.add(name);
        continue;
      }
      const mutant = mutate(base, random, typed, { allows: text => bed.allows(text) });
      if (mutant) return { source: "mutation", seed, text: typed ? mutant.text : reprinted(mutant.text), extension, notes: `${name}: ${mutant.applied.join(", ")}`, base: { name, text: base, extension } };
    }
  };
}

function asTheyAre(root: string): Source | undefined {
  const files = singleFilePrograms(root);
  if (!files.length) return;
  return (seed, bed) => {
    if (bed.name !== "product") return;
    const path = files[seed % files.length];
    const text = readFileSync(path, "utf8");
    if (text.length > 60_000 || cannotStandAlone.test(text)) return;
    return { source: "programs-as-they-are", seed, text: path.endsWith(".js") && !/^(import|export)\b/m.test(text) ? staysAScript + text : text, extension: path.endsWith(".ts") ? "ts" : "js", notes: relative(root, path) };
  };
}

function everyBirthAndUse(): Source | undefined {
  const folder = join(import.meta.dir, "..", "generated", "births-and-uses");
  if (!existsSync(folder)) return;
  const names = readdirSync(folder)
    .filter(name => name.endsWith(".ts") && name !== "run.ts" && !(process.env.AOT_FUZZ_BIRTHS_WITHOUT ?? "").split(",").includes(name))
    .sort();
  const differs = new Set(Object.values(JSON.parse(readFileSync(join(folder, "known-to-differ.json"), "utf8")) as Record<string, Record<string, string>>).flatMap(Object.keys));
  const tables = new Map<string, { name: string; file: string; text: string; flags?: string[] }[]>();
  return (seed, bed) => {
    if (bed.name !== "product") return;
    const from = names[seed % names.length];
    const typed = Math.floor(seed / names.length) % 2 === 1;
    const key = from + typed;
    if (!tables.has(key)) tables.set(key, require(join(folder, from)).programs(typed));
    const table = tables.get(key)!;
    if (!table.length) return;
    // Neighbours in a table differ in one part: a stride that shares no factor with most lengths takes a batch from all over it.
    const { name, file, text, flags } = table[(Math.floor(seed / (names.length * 2)) * 7919) % table.length];
    if (flags?.length || differs.has(name) || text.length > 60_000) return;
    const program: Program = { text, extension: file.endsWith(".ts") ? "ts" : "js" };
    return bed.accepts(program) && bed.allows(text) ? { source: "every-birth-and-use", seed, ...program, notes: `${from} ${name}`, group: from } : undefined;
  };
}

type Generator = (random: Random, typed: boolean, profile: { library: boolean }) => string;

const generated =
  (source: string, generate: Generator): Source =>
  (seed, bed) => {
    const random = new Random(seed);
    if (source === "many-of-one-thing" && bed.name !== "product") return;
    if ((source === "typed-object-mutations" || source === "held-across-suspensions" || source === "where-the-stack-ends" || source === "changing-buffers" || source === "many-live-values" || source === "a-throw-at-every-call" || source === "values-across-joins" || source === "operators-at-the-edges" || source === "objects-across-awaits" || source === "every-kind-of-job" || source === "work-on-the-way-up" || source === "text-beside-compiled-code") && bed.name !== "product") return;
    const typed = source === "typed-object-mutations" || source === "held-across-suspensions" || source === "where-the-stack-ends" || source === "changing-buffers" || source === "many-live-values" || source === "a-throw-at-every-call" || source === "values-across-joins" || source === "operators-at-the-edges" || source === "objects-across-awaits" || source === "every-kind-of-job" || source === "work-on-the-way-up" || source === "text-beside-compiled-code" || (source === "grammar" && bed.name === "product" && random.chance(0.5));
    const program: Program = { text: generate(random, typed, { library: bed.name === "product" }), extension: typed ? "ts" : "js" };
    return bed.accepts(program) && bed.allows(program.text) ? { source, seed, ...program, notes: typed ? "typed" : "untyped" } : undefined;
  };

/** A source that writes TypeScript, for the product alone. */
const typedForTheProduct =
  (source: string, generate: Generator): Source =>
  (seed, bed) => {
    if (bed.name !== "product") return;
    const program: Program = { text: generate(new Random(seed), true, { library: true }), extension: "ts" };
    return bed.accepts(program) && bed.allows(program.text) ? { source, seed, ...program, notes: "typed" } : undefined;
  };

/** `rejected` receives the names of the base programs that cannot be used; the caller adds those that differ unchanged. */
export async function allSources(programsRoot: string, rejected: Set<string>): Promise<Record<string, Source>> {
  const sources: Record<string, Source> = {};
  const mutants = mutation(programsRoot, rejected);
  if (mutants) sources.mutation = mutants;
  const unchanged = asTheyAre(programsRoot);
  if (unchanged) sources["programs-as-they-are"] = unchanged;
  const pairs = everyBirthAndUse();
  if (pairs) sources["every-birth-and-use"] = pairs;
  if (existsSync(join(import.meta.dir, "one-key-asked-in-every-way.ts"))) {
    const { generate } = await import("./one-key-asked-in-every-way.ts");
    sources["one-key-asked-in-every-way"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text) ? { source: "one-key-asked-in-every-way", seed, ...program, notes: typed ? "typed" : "untyped" } : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "unsound-types.ts"))) {
    const { draw } = await import("./unsound-types.ts");
    sources["unsound-types"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const { text, hole, parts, alone } = draw(new Random(seed));
      return { source: "unsound-types", seed, text, extension: "ts", notes: parts.map(each => each.join(", ")).join(" | "), group: hole, alone, isForTypeScript: true };
    };
  }
  for (const name of ["grammar", "protocols", "new-targets", "object-mutations", "typed-object-mutations", "held-across-suspensions", "where-the-stack-ends", "many-of-one-thing", "changing-buffers", "many-live-values", "a-throw-at-every-call", "values-across-joins", "operators-at-the-edges", "objects-across-awaits", "every-kind-of-job", "work-on-the-way-up", "text-beside-compiled-code", "several-changes-one-behind-the-other"]) if (existsSync(join(import.meta.dir, name + ".ts"))) sources[name] = generated(name, (await import(`./${name}.ts`)).generate);
  for (const name of ["when-the-heap-is-full", "held-by-one-thing-alone", "errors-nobody-catches", "shapes-that-die-and-come-again", "workers-ended-in-the-middle", "calls-with-very-many-arguments", "strings-still-in-pieces", "changed-while-it-is-walked", "left-half-way", "numbers-across-their-borders", "at-the-border-of-a-representation", "patterns-made-at-run-time", "lists-read-where-they-are-made", "numbers-however-they-are-kept", "objects-read-where-they-are-made", "patterns-that-go-back-for-millions-of-turns", "errors-of-values-nobody-uses", "constant-lists-changed-by-every-road", "new-objects-kept-through-built-ins", "typed-instances-changed-through-built-ins", "several-changes-behind-a-declared-type", "two-names-where-ways-meet", "objects-with-very-many-fields", "one-name-for-many-kinds-of-things", "objects-that-the-host-keeps-and-hands-back", "closures-read-through-array-methods", "objects-that-live-for-one-turn-of-a-loop", "patterns-with-subjects-made-from-them", "bodies-in-every-encoding-read-as-json"]) if (existsSync(join(import.meta.dir, name + ".ts"))) sources[name] = typedForTheProduct(name, (await import(`./${name}.ts`)).generate);
  return sources;
}
