/**
 * `<buildDir>/timings.html`: the build as a chart. One page, no dependencies, the data inside it.
 *
 * Each run of ninja still in the log is a Gantt chart: a bar per command from its start to its end, in the first
 * free row, under a strip of how many commands were running. The commands on the critical path (timings.ts
 * `criticalPath`) get the top rows to themselves, so the chain reads as a staircase: each step starts where the one
 * before it released what it needed, which for a library crate is the tick inside its bar (its `.rmeta`), not its end.
 */

import { relative } from "node:path";
import type { RuleName } from "./ninja.ts";
import { type Build, type Execution, type Run, clock, criticalPath, topLevelPhases, waits } from "./timings.ts";

/**
 * What a bar's color says. Any two bars can end up side by side, and only three hues stay apart for every pair of
 * them under color-vision deficiency on both a light and a dark page; the rest is a neutral. The hover names the rule.
 */
const kinds = ["C and C++", "Rust", "codegen and dependencies", "link, checks and the rest"] as const;
type Kind = (typeof kinds)[number];

const ruleKind: Record<RuleName, Kind> = {
  cc: "C and C++",
  cxx: "C and C++",
  cxx_pch: "C and C++",
  nasm: "C and C++",
  pch: "C and C++",
  pch_msvc: "C and C++",
  rc: "C and C++",
  rust_build_script: "Rust",
  rust_plan: "Rust",
  rust_rustc: "Rust",
  bun_install: "codegen and dependencies",
  codegen: "codegen and dependencies",
  codegen_bun: "codegen and dependencies",
  esbuild: "codegen and dependencies",
  npm_install: "codegen and dependencies",
  dep_build: "codegen and dependencies",
  dep_cargo: "codegen and dependencies",
  dep_cargo_cross: "codegen and dependencies",
  dep_check_undefined: "codegen and dependencies",
  dep_codegen: "codegen and dependencies",
  dep_configure: "codegen and dependencies",
  dep_fetch: "codegen and dependencies",
  dep_fetch_prebuilt: "codegen and dependencies",
  dep_host_cc: "codegen and dependencies",
  dep_prebuild: "codegen and dependencies",
  dep_subst: "codegen and dependencies",
  ar: "link, checks and the rest",
  binary_verify: "link, checks and the rest",
  copy_exe: "link, checks and the rest",
  dsymutil: "link, checks and the rest",
  duplicate_symbols: "link, checks and the rest",
  link: "link, checks and the rest",
  shim_verify: "link, checks and the rest",
  smoke_test: "link, checks and the rest",
  strip: "link, checks and the rest",
  bk_upload: "link, checks and the rest",
  bk_upload_gz: "link, checks and the rest",
  host_tool_cc: "link, checks and the rest",
  mkdir_stamp: "link, checks and the rest",
  regen: "link, checks and the rest",
  shim_crt_decompress: "link, checks and the rest",
};

export interface ChartBar {
  label: string;
  rule: string;
  kind: number;
  start: number;
  end: number;
  row: number;
  /** Its place on the critical path, when it is on it. */
  step: number | undefined;
  /** Milliseconds after `start` that it held up the next step of the path. */
  blocksNextForMs: number | undefined;
  /** Milliseconds after `start` that it released an output to its dependents. */
  released: number | undefined;
  waited: number;
  pool: string | undefined;
  phases: [name: string, ms: number][];
}

export interface ChartRun {
  title: string;
  wallMs: number;
  /** The rows kept for the critical path, above the rest. */
  pathRows: number;
  rows: number;
  bars: ChartBar[];
}

export interface ChartData {
  buildDir: string;
  kinds: readonly string[];
  criticalPathMs: number;
  edges: number;
  /** Most recent first. */
  runs: ChartRun[];
}

/** The runs the page draws: the most recent, and as many before it as the report lists. */
const RUNS_DRAWN = 11;
const PHASES_SHOWN = 4;

function chartRun(build: Build, run: Run, steps: Map<Execution, { step: number; blocksNextForMs: number }>): ChartRun {
  const waited = waits(build, run);
  const rowFreeAt: number[][] = [[], []];
  // Each bar goes in the first row of its group that is free when it starts.
  const place = (group: number, x: Execution): number => {
    const rows = rowFreeAt[group]!;
    let row = rows.findIndex(freeAt => freeAt <= x.start);
    if (row < 0) row = rows.length;
    rows[row] = x.end;
    return row;
  };
  const placed = run.executions.map(x => ({ x, onPath: steps.has(x), row: place(steps.has(x) ? 0 : 1, x) }));
  const pathRows = rowFreeAt[0]!.length;
  return {
    title: clock(run.epochMs),
    wallMs: Math.max(...run.executions.map(x => x.end)),
    pathRows,
    rows: pathRows + rowFreeAt[1]!.length,
    bars: placed.map(({ x, onPath, row }) => ({
      label: x.label,
      rule: x.edge.rule,
      kind: kinds.indexOf(ruleKind[x.edge.rule as RuleName] ?? "link, checks and the rest"),
      start: x.start,
      end: x.end,
      row: onPath ? row : pathRows + row,
      step: steps.get(x)?.step,
      blocksNextForMs: steps.get(x)?.blocksNextForMs,
      released: x.released.size > 0 ? Math.min(...x.released.values()) : undefined,
      waited: waited.get(x) ?? 0,
      pool: x.pool,
      phases: topLevelPhases(x.selfReport)
        .map((p): [string, number] => [p.name, p.endMs - p.startMs])
        .sort((a, b) => b[1] - a[1])
        .slice(0, PHASES_SHOWN),
    })),
  };
}

export function chartData(build: Build): ChartData {
  const path = criticalPath(build);
  const steps = new Map(path.steps.map((s, step) => [s.execution, { step, blocksNextForMs: s.blocksNextForMs }]));
  return {
    buildDir: relative(process.cwd(), build.buildDir) || ".",
    kinds,
    criticalPathMs: path.totalMs,
    edges: build.last.size,
    runs: [...build.runs]
      .reverse()
      .slice(0, RUNS_DRAWN)
      .map(run => chartRun(build, run, steps)),
  };
}

export function chartHtml(build: Build): string {
  // `<` escaped so that no label can end the script element.
  const data = JSON.stringify(chartData(build)).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>build timings</title>
<style>${css}</style>
</head>
<body>
<main class="viz-root">
  <header>
    <h1>build timings</h1>
    <p id="where"></p>
    <div id="tiles"></div>
    <div id="controls">
      <div id="legend"></div>
      <label>zoom, or scroll over a chart <input id="zoom" type="range" min="1" max="200" step="0.1" value="1"></label>
    </div>
  </header>
  <div id="runs"></div>
  <details id="table"><summary>The critical path as a table</summary><div id="tablebody"></div></details>
</main>
<div id="tip" hidden></div>
<script id="data" type="application/json">${data}</script>
<script>${client}</script>
</body>
</html>
`;
}

// The three hues pass an all-pairs check for color-vision-deficiency and normal-vision separation on each surface.
const css = `
:root {
  color-scheme: light;
  --surface: #fcfcfb; --raised: #f3f2ef; --text: #0b0b0b; --text-2: #52514e; --grid: #e4e3df;
  --k0: #2a78d6; --k1: #eb6834; --k2: #1baf7a; --k3: #a3a29b;
}
/* A page that embeds this one can pin the theme with data-theme; without it the system's setting decides. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --raised: #262624; --text: #ffffff; --text-2: #c3c2b7; --grid: #383835;
    --k0: #3987e5; --k1: #d95926; --k2: #199e70; --k3: #6f6e68;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --raised: #262624; --text: #ffffff; --text-2: #c3c2b7; --grid: #383835;
  --k0: #3987e5; --k1: #d95926; --k2: #199e70; --k3: #6f6e68;
}
body { margin: 0; background: var(--surface); }
.viz-root { background: var(--surface); color: var(--text); font: 14px/1.4 system-ui, sans-serif; padding: 24px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 32px 0 2px; }
p, .meta { color: var(--text-2); margin: 2px 0 0; }
#tiles { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
.tile { background: var(--raised); border-radius: 8px; padding: 10px 14px; min-width: 150px; }
.tile b { display: block; font-size: 22px; font-weight: 600; }
.tile span { color: var(--text-2); font-size: 12px; }
#controls { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
#legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--text-2); }
#legend i { display: inline-block; width: 18px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
#legend i.path { background: none; box-shadow: inset 0 0 0 1.5px var(--text); }
#legend i.tick { background: linear-gradient(to right, var(--k1) 45%, var(--surface) 45% 60%, var(--k1) 60%); }
label { font-size: 12px; color: var(--text-2); }
.scroll { overflow-x: auto; border-radius: 8px; background: var(--raised); margin-top: 8px; }
svg { display: block; }
svg text { font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--text-2); }
svg text.in { fill: #0b0b0b; pointer-events: none; }
.bar { rx: 2px; }
.faded { opacity: 0.4; }
.onpath { stroke: var(--text); stroke-width: 1.5px; }
.bar:hover { opacity: 1; stroke: var(--text); stroke-width: 1px; }
.link { stroke: var(--text); stroke-width: 1.5px; fill: none; }
.tickmark { stroke: var(--surface); stroke-width: 2px; pointer-events: none; }
.grid { stroke: var(--grid); stroke-width: 1px; }
.running { fill: var(--text-2); opacity: 0.35; }
#tip { position: fixed; z-index: 1; max-width: 420px; background: var(--surface); color: var(--text); border: 1px solid var(--grid);
  border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.2); pointer-events: none; }
#tip b { display: block; word-break: break-all; }
#tip div { color: var(--text-2); }
details { margin-top: 32px; }
table { border-collapse: collapse; margin-top: 8px; font-size: 12px; }
td, th { text-align: left; padding: 3px 14px 3px 0; border-bottom: 1px solid var(--grid); }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
`;

// Plain JavaScript, kept free of template literals so it can sit inside one.
const client = `
(function () {
  var data = JSON.parse(document.getElementById("data").textContent);
  var NS = "http://www.w3.org/2000/svg";
  var ROW = 14, BAR = 12, LEFT = 8, RIGHT = 24, STRIP = 44, AXIS = 18, GAP = 10, CHAR = 6.05;
  var zoom = document.getElementById("zoom");
  var level = 1;
  var tip = document.getElementById("tip");

  function ms(t) { return t < 1000 ? Math.round(t) + "ms" : (t / 1000).toFixed(1) + "s"; }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function html(tag, text, parent, cls) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  document.getElementById("where").textContent = data.buildDir;
  var tiles = document.getElementById("tiles");
  function tile(value, caption) { var t = html("div", undefined, tiles, "tile"); html("b", value, t); html("span", caption, t); }
  tile(ms(data.criticalPathMs), "critical path: a build of everything with every core free");
  tile(String(data.edges), "edges, each as it last ran");
  if (data.runs.length > 0) tile(ms(data.runs[0].wallMs), "wall time of the most recent run of ninja");

  var legend = document.getElementById("legend");
  data.kinds.forEach(function (k, i) {
    var s = html("span", undefined, legend); var sw = html("i", undefined, s); sw.style.background = "var(--k" + i + ")";
    s.appendChild(document.createTextNode(k));
  });
  var lp = html("span", undefined, legend); html("i", undefined, lp, "path"); lp.appendChild(document.createTextNode("on the critical path"));
  var lt = html("span", undefined, legend); html("i", undefined, lt, "tick"); lt.appendChild(document.createTextNode("dependents released here"));

  function niceStep(span, width) {
    var steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] * 90 <= width) return steps[i];
    return steps[steps.length - 1];
  }

  function draw(run, host) {
    host.textContent = "";
    var plot = plotWidth(host);
    var width = plot + LEFT + RIGHT;
    var x = function (t) { return LEFT + t / run.wallMs * plot; };
    var top = STRIP + GAP;
    var pathGap = run.pathRows > 0 ? GAP : 0;
    var y = function (row) { return top + row * ROW + (row >= run.pathRows ? pathGap : 0); };
    var height = y(run.rows) + AXIS;
    var svg = el("svg", { width: width, height: height, role: "img", "aria-label": "commands of the run at " + run.title }, host);

    var step = niceStep(run.wallMs, plot);
    for (var t = 0; t <= run.wallMs; t += step) {
      el("line", { x1: x(t), x2: x(t), y1: 0, y2: height - AXIS, "class": "grid" }, svg);
      el("text", { x: x(t) + 3, y: height - 5 }, svg).textContent = ms(t);
    }

    // How many commands were running.
    var events = [];
    run.bars.forEach(function (b) { events.push([b.start, 1], [b.end, -1]); });
    events.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var most = 0, now = 0;
    events.forEach(function (e) { now += e[1]; if (now > most) most = now; });
    var d = "M" + x(0) + "," + STRIP, level = 0;
    events.forEach(function (e) {
      d += "H" + x(e[0]);
      level += e[1];
      d += "V" + (STRIP - level / most * (STRIP - 12));
    });
    el("path", { d: d + "H" + x(run.wallMs) + "V" + STRIP + "Z", "class": "running" }, svg);
    el("text", { x: LEFT + 3, y: 10 }, svg).textContent = "commands running (most: " + most + ")";

    if (run.pathRows > 0) {
      el("line", { x1: 0, x2: width, y1: y(run.pathRows) - pathGap / 2, y2: y(run.pathRows) - pathGap / 2, "class": "grid" }, svg);
    }
    var steps = run.bars.filter(function (b) { return b.step !== undefined; }).sort(function (a, b) { return a.step - b.step; });
    for (var i = 0; i + 1 < steps.length; i++) {
      var from = steps[i], to = steps[i + 1];
      var x1 = x(from.start + from.blocksNextForMs), x2 = x(to.start);
      var y1 = y(from.row) + BAR / 2, y2 = y(to.row) + BAR / 2;
      if (from.row === to.row) continue;
      el("path", { d: "M" + x1 + "," + y1 + "V" + y2 + "H" + x2, "class": "link" }, svg);
    }

    var fade = run.pathRows > 0;
    run.bars.forEach(function (b, i) {
      var w = Math.max(1.5, x(b.end) - x(b.start));
      var r = el("rect", {
        x: x(b.start), y: y(b.row), width: w, height: BAR, fill: "var(--k" + b.kind + ")",
        "class": "bar" + (b.step !== undefined ? " onpath" : fade ? " faded" : ""), "data-i": i,
      }, svg);
      if (b.released !== undefined) {
        el("line", { x1: x(b.start + b.released), x2: x(b.start + b.released), y1: y(b.row), y2: y(b.row) + BAR, "class": "tickmark" }, svg);
      }
      var chars = Math.floor((w - 8) / CHAR);
      if (chars >= 5) {
        var label = b.label.length > chars ? b.label.slice(0, chars - 1) + "…" : b.label;
        el("text", { x: x(b.start) + 4, y: y(b.row) + BAR - 3, "class": "in" }, svg).textContent = label;
      }
    });

    svg.addEventListener("mousemove", function (ev) {
      var i = ev.target.getAttribute && ev.target.getAttribute("data-i");
      if (i === null || i === undefined) { tip.hidden = true; return; }
      var b = run.bars[i];
      tip.textContent = "";
      html("b", b.label, tip);
      html("div", data.kinds[b.kind] + " · rule " + b.rule + (b.pool ? " · pool " + b.pool : ""), tip);
      html("div", ms(b.end - b.start) + " · from " + ms(b.start) + " to " + ms(b.end), tip);
      if (b.waited > 0) html("div", "waited " + ms(b.waited) + " after its inputs existed", tip);
      if (b.released !== undefined) html("div", "dependents could start after " + ms(b.released), tip);
      if (b.step !== undefined) html("div", "critical path step " + (b.step + 1) + ": holds up the next for " + ms(b.blocksNextForMs), tip);
      if (b.phases.length > 0) html("div", b.phases.map(function (p) { return p[0] + " " + ms(p[1]); }).join(" · "), tip);
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - tw - 8) + "px";
      tip.style.top = (ev.clientY + 18 + th > window.innerHeight ? ev.clientY - th - 10 : ev.clientY + 18) + "px";
    });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; });
  }

  var runs = document.getElementById("runs");
  var hosts = data.runs.map(function (run, i) {
    html("h2", (i === 0 ? "most recent run of ninja · " : "earlier run · ") + run.title, runs);
    var sum = run.bars.reduce(function (s, b) { return s + b.end - b.start; }, 0);
    html("div", ms(run.wallMs) + " wall · " + run.bars.length + " edges · " + ms(sum) + " of commands · " +
      (sum / run.wallMs).toFixed(1) + "× average parallelism", runs, "meta");
    return html("div", undefined, runs, "scroll");
  });
  function plotWidth(host) { return Math.max(320, host.clientWidth) * level - LEFT - RIGHT; }
  function drawAll() { data.runs.forEach(function (run, i) { draw(run, hosts[i]); }); }
  // Zoom every chart, keeping the moment under the cursor (or, away from the cursor, at the middle of the view) still.
  function zoomTo(value, overHost, clientX) {
    var anchors = hosts.map(function (host) {
      var at = host === overHost ? clientX - host.getBoundingClientRect().left : host.clientWidth / 2;
      return { at: at, moment: (host.scrollLeft + at - LEFT) / plotWidth(host) };
    });
    level = Math.min(Number(zoom.max), Math.max(Number(zoom.min), value));
    zoom.value = level;
    drawAll();
    hosts.forEach(function (host, i) { host.scrollLeft = LEFT + anchors[i].moment * plotWidth(host) - anchors[i].at; });
  }
  zoom.addEventListener("input", function () { zoomTo(Number(zoom.value)); });
  window.addEventListener("resize", drawAll);
  hosts.forEach(function (host) {
    var turned = 0, clientX = 0, queued = false;
    host.addEventListener("wheel", function (ev) {
      // A sideways scroll pans the chart.
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
      ev.preventDefault();
      turned += ev.deltaY * (ev.deltaMode === 1 ? 16 : 1);
      clientX = ev.clientX;
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        // Up zooms in, down zooms out; a notch of a wheel (about 100) is a quarter more or less.
        zoomTo(level * Math.exp(-turned * 0.0022), host, clientX);
        turned = 0;
      });
    }, { passive: false });
  });
  drawAll();

  var all = [];
  data.runs.forEach(function (run) { run.bars.forEach(function (b) { if (b.step !== undefined) all.push([b, run]); }); });
  all.sort(function (a, b) { return a[0].step - b[0].step; });
  var table = html("table", undefined, document.getElementById("tablebody"));
  var head = html("tr", undefined, table);
  ["step", "edge", "holds up the next for", "runs for", "in the run at"].forEach(function (h, i) { html("th", h, head, i === 2 || i === 3 ? "n" : ""); });
  all.forEach(function (p) {
    var tr = html("tr", undefined, table);
    html("td", String(p[0].step + 1), tr); html("td", p[0].label, tr);
    html("td", ms(p[0].blocksNextForMs), tr, "n"); html("td", ms(p[0].end - p[0].start), tr, "n"); html("td", p[1].title, tr);
  });
})();
`;
