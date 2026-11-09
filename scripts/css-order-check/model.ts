// A small model of CSS Cascading 5 for `@import`, `@layer`, `@media` and `@supports`.
// It evaluates a graph of CSS files the way a browser does, and it evaluates a bundle the same way.
// Every style rule is `.t { --k: <id> }`. The observables are:
//   normal:    the ids sorted by cascade priority (lowest first), each id at its best occurrence.
//   important: the same order if every declaration were `!important` (layer order reversed).
//   order:     for each named layer path, its named sublayers in the order of first declaration.
// Two style sheets with equal observables give every element the same winner for every pair of rules.

export type Node =
  | { type: "import"; url: string; layer?: string; supports?: string; media?: string }
  | { type: "layers"; names: string[] }
  | { type: "block"; at: string; prelude: string; children: Node[] }
  | { type: "style"; selector: string; declarations: string }
  | { type: "other"; at: string; prelude: string };

export function parse(css: string): Node[] {
  let i = 0;
  const n = css.length;
  const skipWs = () => {
    for (;;) {
      while (i < n && /\s/.test(css[i])) i++;
      if (css.startsWith("/*", i)) {
        const e = css.indexOf("*/", i + 2);
        i = e < 0 ? n : e + 2;
      } else break;
    }
  };
  const readString = (q: string) => {
    let out = "";
    i++;
    while (i < n && css[i] !== q) {
      if (css[i] === "\\") {
        i++;
        const m = /^[0-9a-fA-F]{1,6}/.exec(css.slice(i, i + 6));
        if (m) {
          out += String.fromCodePoint(parseInt(m[0], 16));
          i += m[0].length;
          if (css[i] === " ") i++;
        } else if (css[i] === "\n") i++;
        else out += css[i++];
      } else out += css[i++];
    }
    i++;
    return out;
  };
  const readPrelude = () => {
    const start = i;
    let depth = 0;
    while (i < n) {
      const c = css[i];
      if (c === '"' || c === "'") {
        readString(c);
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (depth <= 0 && (c === ";" || c === "{" || c === "}")) break;
      i++;
    }
    return css.slice(start, i).trim();
  };
  const parseImport = (): Node => {
    let url = "";
    if (css[i] === '"' || css[i] === "'") url = readString(css[i]);
    else if (css.slice(i, i + 4).toLowerCase() === "url(") {
      i += 4;
      skipWs();
      if (css[i] === '"' || css[i] === "'") {
        url = readString(css[i]);
        skipWs();
        if (css[i] === ")") i++;
      } else {
        const e = css.indexOf(")", i);
        url = css.slice(i, e).trim();
        i = e + 1;
      }
    }
    skipWs();
    let layer: string | undefined;
    let supports: string | undefined;
    if (/^layer(?![\w-])/i.test(css.slice(i, i + 6))) {
      i += 5;
      if (css[i] === "(") {
        const e = css.indexOf(")", i);
        layer = css.slice(i + 1, e).trim();
        i = e + 1;
      } else layer = "";
    }
    skipWs();
    if (/^supports\(/i.test(css.slice(i, i + 9))) {
      i += 8;
      const start = i + 1;
      let depth = 0;
      do {
        const c = css[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
      } while (depth > 0 && i < n);
      supports = css.slice(start, i - 1).trim();
    }
    skipWs();
    const media = readPrelude();
    if (css[i] === ";") i++;
    return { type: "import", url, layer, supports, media: media || undefined };
  };
  const parseList = (top: boolean): Node[] => {
    const out: Node[] = [];
    for (;;) {
      skipWs();
      if (i >= n) break;
      if (css[i] === "}") {
        i++;
        if (top) continue;
        break;
      }
      if (css[i] === "@") {
        i++;
        const at = (/^[\w-]+/.exec(css.slice(i, i + 40)) ?? [""])[0].toLowerCase();
        i += at.length;
        skipWs();
        if (at === "import") {
          out.push(parseImport());
          continue;
        }
        const prelude = readPrelude();
        if (css[i] === ";") {
          i++;
          if (at === "layer") out.push({ type: "layers", names: prelude.split(",").map(s => s.trim()) });
          else out.push({ type: "other", at, prelude });
        } else if (css[i] === "{") {
          i++;
          out.push({ type: "block", at, prelude, children: parseList(false) });
        } else out.push({ type: "other", at, prelude });
        continue;
      }
      const selector = readPrelude();
      if (css[i] === "{") {
        i++;
        const start = i;
        let depth = 1;
        while (i < n && depth > 0) {
          const c = css[i];
          if (c === '"' || c === "'") {
            readString(c);
            continue;
          }
          if (c === "{") depth++;
          else if (c === "}") depth--;
          i++;
        }
        out.push({ type: "style", selector, declarations: css.slice(start, i - 1) });
      } else i++;
    }
    return out;
  };
  return parseList(true);
}

export type Evaluation = {
  normal: string[];
  important: string[];
  order: Record<string, string[]>;
  /** id -> the layer of its best normal occurrence, as a path with "<anon N>" segments. */
  layerOf: Record<string, string>;
  problems: string[];
};

type Layer = { name: string; path?: string; children: Layer[]; label: string };

export type Files = Record<string, string>;
export type Externals = (url: string) => string | undefined;

const mediaHolds = (text: string, state: ReadonlySet<string>) => {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "all") return true;
  const m = /min-width:\s*(\d+)px/.exec(t);
  if (m) return state.has("m" + m[1]);
  return state.has(t);
};
const supportsHolds = (text: string, state: ReadonlySet<string>) => {
  const m = /top:\s*(\d+)px/.exec(text);
  if (m) return state.has("s" + m[1]);
  return state.has("supports:" + text.trim());
};

/** The condition keys ("m1", "s2", "screen", ...) that a CSS text mentions. */
export function conditionKeys(css: string): string[] {
  const keys = new Set<string>();
  for (const [, n] of css.matchAll(/min-width:\s*(\d+)px/g)) keys.add("m" + n);
  for (const [, n] of css.matchAll(/top:\s*(\d+)px/g)) keys.add("s" + n);
  for (const [word] of css.matchAll(/\b(screen|print)\b/g)) keys.add(word);
  return [...keys].sort();
}

function decodeDataUrl(url: string): string | undefined {
  const m = /^data:text\/css(;base64)?,/i.exec(url);
  if (!m) return undefined;
  const body = url.slice(m[0].length);
  if (m[1]) return atob(body);
  try {
    return decodeURIComponent(body);
  } catch {
    return body.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
}

export function evaluate(
  files: Files,
  entry: string,
  state: ReadonlySet<string> = new Set(),
  externals: Externals = () => undefined,
): Evaluation {
  const order: Record<string, string[]> = {};
  let anon = 0;
  const root: Layer = { name: "", path: "", children: [], label: "" };
  const rules: { layer: Layer; id: string; seq: number }[] = [];
  const problems: string[] = [];
  const child = (parent: Layer, name: string) => {
    let layer = name ? parent.children.find(s => s.name === name) : undefined;
    if (!layer) {
      const label = (parent.label && parent.label + ".") + (name || `<anon ${++anon}>`);
      parent.children.push((layer = { name, children: [], label }));
      if (name && parent.path !== undefined) {
        layer.path = (parent.path && parent.path + ".") + name;
        (order[parent.path] ??= []).push(name);
      }
    }
    return layer;
  };
  const descend = (from: Layer, path: string) =>
    path
      .split(".")
      .map(s => s.trim())
      .filter(Boolean)
      .reduce((layer, name) => child(layer, name), from);

  const apply = (nodes: Node[], into: Layer, chain: string[], top: boolean, where: string) => {
    let canImport = top;
    let sawImport = false;
    for (const node of nodes) {
      switch (node.type) {
        case "import": {
          if (!canImport) {
            problems.push(`invalid @import "${node.url.slice(0, 60)}" in ${where}: it does not apply`);
            break;
          }
          sawImport = true;
          if (node.supports !== undefined && !supportsHolds(node.supports, state)) break;
          if (node.media !== undefined && !mediaHolds(node.media, state)) break;
          const layer = node.layer === undefined ? into : node.layer === "" ? child(into, "") : descend(into, node.layer);
          const data = decodeDataUrl(node.url);
          if (data !== undefined) {
            apply(parse(data), layer, chain, true, "a data: import");
          } else if (/^(https?:)?\/\//.test(node.url)) {
            const text = externals(node.url);
            if (text !== undefined) apply(parse(text), layer, chain, true, node.url);
          } else {
            const target = node.url.replace(/^\.\//, "");
            if (target in files && target.endsWith(".css") && !chain.includes(target)) {
              apply(parse(files[target]), layer, [...chain, target], true, target);
            }
          }
          break;
        }
        case "layers":
          if (sawImport) canImport = false;
          for (const name of node.names) descend(into, name);
          break;
        case "other":
          if (node.at !== "charset") canImport &&= false;
          break;
        case "block": {
          canImport = false;
          if (node.at === "layer") {
            apply(node.children, node.prelude ? descend(into, node.prelude) : child(into, ""), chain, false, where);
          } else if (node.at === "media") {
            if (mediaHolds(node.prelude, state)) apply(node.children, into, chain, false, where);
          } else if (node.at === "supports") {
            if (supportsHolds(node.prelude, state)) apply(node.children, into, chain, false, where);
          }
          break;
        }
        case "style":
          canImport = false;
          for (const [, id] of node.declarations.matchAll(/--k\s*:\s*([^;\s}]+)/g)) {
            rules.push({ layer: into, id, seq: rules.length });
          }
          break;
      }
    }
  };
  apply(parse(files[entry]), root, [entry], true, entry);

  // A later sibling beats an earlier one. The rules a layer has itself beat those of its sublayers.
  const rank = new Map<Layer, number>();
  const visit = (layer: Layer) => {
    layer.children.forEach(visit);
    rank.set(layer, rank.size);
  };
  visit(root);

  const bestNormal = new Map<string, { rank: number; seq: number; layer: Layer }>();
  const bestImportant = new Map<string, { rank: number; seq: number }>();
  for (const rule of rules) {
    const r = rank.get(rule.layer)!;
    const n = bestNormal.get(rule.id);
    if (!n || r > n.rank || (r === n.rank && rule.seq > n.seq)) bestNormal.set(rule.id, { rank: r, seq: rule.seq, layer: rule.layer });
    const im = bestImportant.get(rule.id);
    // Among important declarations an earlier layer wins, and in one layer the later declaration wins.
    if (!im || r < im.rank || (r === im.rank && rule.seq > im.seq)) bestImportant.set(rule.id, { rank: r, seq: rule.seq });
  }
  const normal = [...bestNormal].sort(([, a], [, b]) => a.rank - b.rank || a.seq - b.seq).map(([id]) => id);
  const important = [...bestImportant].sort(([, a], [, b]) => b.rank - a.rank || a.seq - b.seq).map(([id]) => id);
  const layerOf: Record<string, string> = {};
  for (const [id, { layer }] of bestNormal) layerOf[id] = layer.label;
  return { normal, important, order, layerOf, problems };
}

export type Problem = { kind: "pair" | "pair-hoist" | "important" | "layers" | "invalid"; text: string };

/** `isExternal(id)`: the rule of an external file. A pair with one, both in one layer in the sources, cannot keep its order under a hoist. */
export function compare(expected: Evaluation, actual: Evaluation, isExternal: (id: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  for (const text of actual.problems) problems.push({ kind: "invalid", text });
  const pairs = (list: string[], other: string[], kind: "pair" | "important") => {
    const pos = new Map(other.map((id, i) => [id, i]));
    const missing = list.filter(id => !pos.has(id));
    const extra = other.filter(id => !list.includes(id));
    if (missing.length) problems.push({ kind, text: `${kind}: the bundle has no rule ${missing.join(", ")}` });
    if (extra.length) problems.push({ kind, text: `${kind}: the bundle has the extra rule ${extra.join(", ")}` });
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const [lo, hi] = [list[a], list[b]];
        if (!pos.has(lo) || !pos.has(hi)) continue;
        if (pos.get(lo)! > pos.get(hi)!) {
          const hoist = (isExternal(lo) || isExternal(hi)) && expected.layerOf[lo] === expected.layerOf[hi];
          problems.push({
            kind: hoist ? "pair-hoist" : kind,
            text: `${kind}: ${hi} beats ${lo} in the sources, and ${lo} beats ${hi} in the bundle`,
          });
        }
      }
    }
  };
  pairs(expected.normal, actual.normal, "pair");
  pairs(expected.important, actual.important, "important");
  for (const parent of new Set([...Object.keys(expected.order), ...Object.keys(actual.order)])) {
    const [sources, bundle] = [expected, actual].map(({ order }) => `[${(order[parent] ?? []).join(", ")}]`);
    if (sources !== bundle) {
      problems.push({ kind: "layers", text: `layers of ${parent || "the root"}: ${sources} in the sources, ${bundle} in the bundle` });
    }
  }
  return problems;
}
