// Random `@import` graphs for the cascade model in model.ts.
export type GraphOptions = {
  cycles?: boolean;
  anonymous?: boolean; // bare `layer` imports
  leadingStatements?: boolean; // default true
  emptyBlocks?: boolean;
  conditions?: boolean; // `@media` / `@supports` blocks in a file
  importConditions?: boolean; // `supports()` / media on an `@import`
  external?: boolean; // external imports
  externalRules?: boolean; // each external file has one rule (else it is empty)
  assets?: boolean; // imports of an .svg
  anonBlocks?: boolean; // `@layer { ... }` blocks
  emptyFiles?: boolean;
};

export function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const names = ["a", "b", "c"];
const wrappers = ["w", "v"];

export function generateGraph(seed: number, options: GraphOptions = {}) {
  const {
    cycles = false,
    anonymous = false,
    leadingStatements = true,
    emptyBlocks = false,
    conditions = false,
    importConditions = false,
    external = false,
    assets = false,
    anonBlocks = false,
    emptyFiles = false,
  } = options;
  const rnd = rng(seed);
  const int = (n: number, from = rnd) => Math.floor(from() * n);
  const pick = (pool: string[], from = rnd) => pool[int(pool.length, from)];
  const stem = (i: number) => (i === 0 ? "entry" : `f${i}`);
  const n = 3 + int(5);
  // Each optional shape draws from streams of its own, one per file, so a seed keeps its base graph whatever the options are.
  const own = (shape: number) => Array.from({ length: n }, (_, i) => rng(seed ^ Math.imul(shape * 8 + i, 0x5bd1e995)));
  const [leading, cyclic, anon, empty, conditional, ext, asset, impcond, anonblock, emptyfile] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(own);

  const imports: string[][] = Array.from({ length: n }, () => []);
  const externals: string[] = [];
  const importTail = (i: number, from: () => number) => {
    let tail = "";
    if (anonymous && anon[i]() < 0.3) tail += " layer";
    else if (from() < 0.5) tail += ` layer(${pick(wrappers, from)})`;
    if (importConditions && impcond[i]() < 0.3) {
      const f = impcond[i];
      if (f() < 0.4) tail += ` supports(top: ${1 + int(2, f)}px)`;
      else tail += ` (min-width: ${1 + int(2, f)}px)`;
    }
    return tail;
  };
  const addImport = (i: number, url: string, from = rnd) => {
    const rule = `@import "${url}"${importTail(i, from)};\n`;
    imports[i].splice(int(imports[i].length + 1, from), 0, rule);
  };
  // Every file is imported from one or two places in lower-numbered files. So there is no cycle, and a file that
  // several chains reach is applied several times.
  for (let target = 1; target < n; target++) {
    for (let count = rnd() < 0.65 ? 1 : 2; count > 0; count--) addImport(int(target), `./${stem(target)}.css`);
  }

  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    let rules = 0;
    const style = () => `.t { --k: ${stem(i)}r${rules++} }`;
    const outer = (from = rnd) => pick(from() < 0.25 ? wrappers : names, from);
    const statement = (from = rnd) => {
      const path = () => outer(from) + (from() < 0.2 ? "." + pick(names, from) : "");
      return `@layer ${[...new Set(Array.from({ length: 1 + int(3, from) }, path))].join(", ")};\n`;
    };
    if (cycles && cyclic[i]() < 0.2) addImport(i, `./${stem(int(i + 1, cyclic[i]))}.css`, cyclic[i]);
    if (external) {
      for (let k = ext[i]() < 0.35 ? 1 + int(2, ext[i]) : 0; k > 0; k--) {
        // A few URLs are shared, so one external file can be imported from several places.
        const name = `e${1 + int(3, ext[i])}`;
        if (!externals.includes(name)) externals.push(name);
        addImport(i, `https://example.com/${name}.css`, ext[i]);
      }
    }
    if (assets && asset[i]() < 0.2) {
      files["a1.svg"] = "<svg/>";
      addImport(i, "./a1.svg", asset[i]);
    }
    let css = "";
    if (leadingStatements && imports[i].length && leading[i]() < 0.5) {
      css += statement(leading[i]) + (leading[i]() < 0.4 ? statement(leading[i]) : "");
    }
    css += imports[i].join("");
    let lastSupports = 0;
    const isEmpty = emptyFiles && i > 0 && emptyfile[i]() < 0.15;
    for (let items = isEmpty ? 0 : 1 + int(4); items > 0; items--) {
      if (emptyBlocks && empty[i]() < 0.3) css += `@layer ${outer(empty[i])} {}\n`;
      const kind = int(20);
      let item: string;
      if (kind < 5) item = statement();
      else if (kind < 13) item = `@layer ${outer()} { ${style()} }\n`;
      else if (kind < 18) {
        item = `@layer ${outer()} { ${rnd() < 0.5 ? style() + " " : ""}@layer ${pick(names)} { ${style()} } }\n`;
      } else item = style() + "\n";
      if (anonBlocks && anonblock[i]() < 0.15) item = `@layer { ${item.trim()} }\n`;
      const from = conditional[i];
      if (conditions && from() < 0.35) {
        const media = from() < 0.7;
        let number = 1 + int(2, from);
        // The minifier drops the second of two adjacent `@supports` rules with one condition.
        if (!media && number === lastSupports) number = 3 - number;
        lastSupports = media ? 0 : number;
        item = `@${media ? `media (min-width: ${number}px)` : `supports (top: ${number}px)`} { ${item.trim()} }\n`;
      } else lastSupports = 0;
      css += item;
    }
    files[stem(i) + ".css"] = css;
  }
  return { files, entry: "entry.css", externals };
}
