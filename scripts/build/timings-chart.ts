/**
 * `<buildDir>/timings.html`: the build as a chart. One page, no dependencies, the data inside it.
 *
 * Each of the most recent runs of ninja is a Gantt chart: a bar per command from its start to its end, in a lane for
 * what it is, under a strip of how many commands of each color were running. The commands on the critical path
 * (timings.ts `criticalPath`) are outlined where they ran, and joined: each step starts where the one before it
 * released what it needed, which for a library crate is the tick inside its bar (its `.rmeta`), not its end. Under
 * the cursor, and for a bar that was clicked, the same is drawn for the chain of commands that bar waited on.
 */

import { relative } from "node:path";
import type { RuleName } from "./ninja.ts";
import {
  type Build,
  type Execution,
  type Run,
  EARLIER_RUNS_LISTED,
  clock,
  criticalPath,
  largestPhases,
  waits,
} from "./timings.ts";

/**
 * A lane of the chart: commands that are the same sort of work, top to bottom in the order a build gets to them.
 * Lanes are told apart by their labels; a lane's color (`--k0` to `--k3` in the page) is one of the three hues that
 * stay apart for every pair of them under color-vision deficiency on both a light and a dark page, or the neutral.
 * The strip of running commands is stacked by color, in the colors' order.
 */
const lanes = [
  { name: "dependencies", color: 2 },
  { name: "codegen", color: 2 },
  { name: "Rust", color: 1 },
  { name: "C and C++", color: 0 },
  { name: "link and checks", color: 3 },
  { name: "other", color: 3 },
] as const;
type Lane = (typeof lanes)[number]["name"];

const ruleLane: Record<RuleName, Lane> = {
  dep_build: "dependencies",
  dep_cargo: "dependencies",
  dep_cargo_cross: "dependencies",
  dep_check_undefined: "dependencies",
  dep_codegen: "dependencies",
  dep_configure: "dependencies",
  dep_fetch: "dependencies",
  dep_fetch_prebuilt: "dependencies",
  dep_host_cc: "dependencies",
  dep_prebuild: "dependencies",
  dep_subst: "dependencies",
  bun_install: "codegen",
  codegen: "codegen",
  codegen_bun: "codegen",
  esbuild: "codegen",
  npm_install: "codegen",
  rust_build_script: "Rust",
  rust_plan: "Rust",
  rust_rustc: "Rust",
  cc: "C and C++",
  cxx: "C and C++",
  cxx_pch: "C and C++",
  nasm: "C and C++",
  pch: "C and C++",
  pch_msvc: "C and C++",
  rc: "C and C++",
  ar: "link and checks",
  binary_verify: "link and checks",
  copy_exe: "link and checks",
  dsymutil: "link and checks",
  duplicate_symbols: "link and checks",
  link: "link and checks",
  shim_verify: "link and checks",
  smoke_test: "link and checks",
  strip: "link and checks",
  bk_upload: "other",
  bk_upload_gz: "other",
  host_tool_cc: "other",
  mkdir_stamp: "other",
  regen: "other",
  shim_crt_decompress: "other",
};

export interface ChartBar {
  label: string;
  rule: string;
  /** Index into the run's `lanes`, and the row within that lane. */
  lane: number;
  row: number;
  start: number;
  end: number;
  /** Its place on the critical path, when it is on it. */
  step: number | undefined;
  /** Milliseconds after `start` that it held up the next step of the path. */
  blocksNextForMs: number | undefined;
  /** Milliseconds after `start` that it released an output to its dependents. */
  released: number | undefined;
  waited: number;
  /** The bar (index into the run's `bars`) that made the last of its inputs to exist, and when it released it. */
  blocker: number | undefined;
  readyAt: number;
  pool: string | undefined;
  phases: [name: string, ms: number][];
}

export interface ChartLane {
  name: string;
  color: number;
  rows: number;
}

export interface ChartRun {
  title: string;
  wallMs: number;
  /** The lanes this run has commands in. */
  lanes: ChartLane[];
  bars: ChartBar[];
}

export interface ChartData {
  buildDir: string;
  criticalPathMs: number;
  edges: number;
  /** Most recent first. */
  runs: ChartRun[];
}

/** The runs the page draws: the most recent, and as many before it as the report lists. */
const RUNS_DRAWN = 1 + EARLIER_RUNS_LISTED;

function chartRun(build: Build, run: Run, steps: Map<Execution, { step: number; blocksNextForMs: number }>): ChartRun {
  const waited = waits(build, run);
  const index = new Map(run.executions.map((x, i) => [x, i]));
  const laneOf = (x: Execution): Lane => ruleLane[x.edge.rule as RuleName] ?? "other";
  const used = lanes.filter(lane => run.executions.some(x => laneOf(x) === lane.name));
  // A bar goes in the first row of its lane with nothing in its way. The critical path is placed first, so its steps
  // take the top rows of their lanes and read as a staircase.
  const taken = used.map((): { start: number; end: number }[][] => []);
  const place = (x: Execution): { lane: number; row: number } => {
    const lane = used.findIndex(l => l.name === laneOf(x));
    const rows = taken[lane]!;
    let row = rows.findIndex(bars => bars.every(b => b.end <= x.start || b.start >= x.end));
    if (row < 0) row = rows.push([]) - 1;
    rows[row]!.push(x);
    return { lane, row };
  };
  const placed = new Map<Execution, { lane: number; row: number }>();
  for (const x of run.executions) if (steps.has(x)) placed.set(x, place(x));
  for (const x of run.executions) if (!steps.has(x)) placed.set(x, place(x));
  return {
    title: clock(run.epochMs),
    wallMs: run.wallMs,
    lanes: used.map((lane, i) => ({ name: lane.name, color: lane.color, rows: taken[i]!.length })),
    bars: run.executions.map(x => ({
      label: x.label,
      rule: x.edge.rule,
      ...placed.get(x)!,
      start: x.start,
      end: x.end,
      step: steps.get(x)?.step,
      blocksNextForMs: steps.get(x)?.blocksNextForMs,
      released: x.released.size > 0 ? Math.min(...x.released.values()) : undefined,
      waited: waited.get(x)!.ms,
      blocker: index.get(waited.get(x)!.blocker!),
      readyAt: waited.get(x)!.readyAt,
      pool: x.pool,
      phases: largestPhases(x),
    })),
  };
}

export function chartData(build: Build): ChartData {
  const path = criticalPath(build);
  const steps = new Map(path.steps.map((s, step) => [s.execution, { step, blocksNextForMs: s.blocksNextForMs }]));
  return {
    buildDir: relative(process.cwd(), build.buildDir) || ".",
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
    <div id="legend"></div>
  </header>
  <div id="runs"></div>
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
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --surface: #1a1a19; --raised: #262624; --text: #ffffff; --text-2: #c3c2b7; --grid: #383835;
    --k0: #3987e5; --k1: #d95926; --k2: #199e70; --k3: #6f6e68;
  }
}
body { margin: 0; background: var(--surface); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
.viz-root { padding: 24px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 32px 0 2px; }
p, .meta { color: var(--text-2); margin: 2px 0 0; }
#tiles { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
.tile { background: var(--raised); border-radius: 8px; padding: 10px 14px; min-width: 150px; }
.tile b { display: block; font-size: 22px; font-weight: 600; }
.tile span { color: var(--text-2); font-size: 12px; }
#legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--text-2); }
#legend .hint { margin-left: auto; }
#legend i { display: inline-block; width: 18px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
#legend i.path { background: none; box-shadow: inset 0 0 0 1.5px var(--text); }
#legend i.tick { background: linear-gradient(to right, var(--k1) 45%, var(--surface) 45% 60%, var(--k1) 60%); }
.run { display: flex; margin-top: 8px; border-radius: 8px; background: var(--raised); }
.gutter { position: relative; flex: none; width: 124px; border-right: 1px solid var(--grid); }
.lane { position: absolute; left: 10px; right: 6px; font-size: 11px; line-height: 16px; color: var(--text-2); white-space: nowrap; }
.lane i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
.scroll { overflow-x: auto; flex: 1; min-width: 0; }
svg { display: block; }
svg text { font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--text-2); }
svg text.in { fill: #0b0b0b; pointer-events: none; }
.bar { rx: 2px; cursor: pointer; }
.faded { opacity: 0.55; }
.onpath { stroke: var(--text); stroke-width: 1.5px; }
.bar:hover { opacity: 1; stroke: var(--text); stroke-width: 1px; }
.dim { opacity: 0.13; }
text.dim { opacity: 0.25; }
.join { stroke: var(--text); stroke-width: 1.5px; fill: none; pointer-events: none; }
.join.forward { stroke-width: 1px; opacity: 0.6; }
.join.hover { stroke-dasharray: 4 3; }
.hoverbar { fill: none; stroke: var(--text); stroke-width: 1.5px; stroke-dasharray: 4 3; rx: 2px; pointer-events: none; }
.tickmark { stroke: var(--surface); stroke-width: 2px; pointer-events: none; }
.grid { stroke: var(--grid); stroke-width: 1px; }
.rule { stroke: var(--text-2); stroke-width: 1px; opacity: 0.45; }
.gutter .rule { position: absolute; left: 0; right: 0; border-top: 1px solid var(--text-2); }
.running { opacity: 0.85; }
#tip { position: fixed; z-index: 1; max-width: 420px; background: var(--surface); color: var(--text); border: 1px solid var(--grid);
  border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.2); pointer-events: none; }
#tip b { display: block; word-break: break-all; }
#tip div { color: var(--text-2); }
`;

// Plain JavaScript, kept free of template literals so it can sit inside one.
const client = `
(function () {
  var data = JSON.parse(document.getElementById("data").textContent);
  var NS = "http://www.w3.org/2000/svg";
  var ROW = 14, BAR = 12, LEFT = 8, RIGHT = 24, STRIP = 50, STRIP_GAP = 20, AXIS = 18, GAP = 10, LANE_GAP = 12, THIN_ROW = 5, NAMED_SHARE = 0.03;
  // The width of a character of a bar's name (10px monospace), and the colors a lane can have (--k0 to --k3).
  var CHAR = 6.05, COLORS = 4;
  var level = 1, MOST_ZOOM = 200;
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
  function barIndex(ev) {
    var i = ev.target.getAttribute && ev.target.getAttribute("data-i");
    return i === null || i === undefined ? undefined : Number(i);
  }

  var legend = document.getElementById("legend");
  var lp = html("span", undefined, legend); html("i", undefined, lp, "path"); lp.appendChild(document.createTextNode("on the critical path"));
  var lt = html("span", undefined, legend); html("i", undefined, lt, "tick"); lt.appendChild(document.createTextNode("dependents can start here"));
  html("span", "scroll to zoom · hover or click a bar", legend, "hint");

  function niceStep(span, width) {
    var steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] * 90 <= width) return steps[i];
    return steps[steps.length - 1];
  }

  function draw(run, host, gutter) {
    var scrolled = host.scrollLeft;
    host.textContent = "";
    gutter.textContent = "";
    var plot = plotWidth(host);
    var width = plot + LEFT + RIGHT;
    var x = function (t) { return LEFT + t / run.wallMs * plot; };
    // A row is full height when a bar in it is on the critical path or lasts a share of the run that can carry a
    // name with the whole run in view, and thin when it holds only slivers: a burst of short commands then costs
    // little room. Decided from the data, not from the zoom, so zooming only stretches the chart sideways.
    var barWidth = function (b) { return Math.max(1.5, x(b.end) - x(b.start)); };
    var chars = function (b) { return Math.floor((barWidth(b) - 8) / CHAR); };
    var tall = run.lanes.map(function (lane) { return new Array(lane.rows).fill(false); });
    run.bars.forEach(function (b) {
      if (b.step !== undefined || (b.end - b.start) / run.wallMs >= NAMED_SHARE) tall[b.lane][b.row] = true;
    });
    var laneTop = [], rowTop = [], top = STRIP + STRIP_GAP;
    run.lanes.forEach(function (lane, i) {
      laneTop.push(top);
      rowTop.push(tall[i].map(function (isTall) { var at = top; top += isTall ? ROW : THIN_ROW; return at; }));
      top += LANE_GAP;
    });
    var y = function (b) { return rowTop[b.lane][b.row]; };
    var h = function (b) { return tall[b.lane][b.row] ? BAR : THIN_ROW - 1; };
    var height = top - LANE_GAP + GAP + AXIS;
    var svg = el("svg", { width: width, height: height, role: "img", "aria-label": "commands of the run at " + run.title }, host);

    var step = niceStep(run.wallMs, plot);
    for (var t = 0; t <= run.wallMs; t += step) {
      el("line", { x1: x(t), x2: x(t), y1: 0, y2: height - AXIS, "class": "grid" }, svg);
      el("text", { x: x(t) + 3, y: height - 5 }, svg).textContent = ms(t);
    }

    // The strip of running commands is a band of its own above the lanes, on the same time axis: a rule under it,
    // through the chart and the gutter.
    el("line", { x1: 0, x2: width, y1: STRIP + STRIP_GAP / 2, y2: STRIP + STRIP_GAP / 2, "class": "rule" }, svg);
    gutter.style.height = height + "px";
    html("div", undefined, gutter, "rule").style.top = STRIP + STRIP_GAP / 2 + "px";

    // The lanes, named in the gutter beside the chart so the names stay put when the chart scrolls.
    html("div", "commands running", gutter, "lane").style.top = STRIP / 2 - 8 + "px";
    run.lanes.forEach(function (lane, i) {
      var name = html("div", undefined, gutter, "lane");
      name.style.top = laneTop[i] - 2 + "px";
      html("i", undefined, name).style.background = "var(--k" + lane.color + ")";
      name.appendChild(document.createTextNode(lane.name));
      if (i > 0) el("line", { x1: 0, x2: width, y1: laneTop[i] - LANE_GAP / 2, y2: laneTop[i] - LANE_GAP / 2, "class": "grid" }, svg);
    });

    // How many commands were running, stacked by color from the bottom.
    var events = [];
    run.bars.forEach(function (b) { var c = run.lanes[b.lane].color; events.push([b.start, 1, c], [b.end, -1, c]); });
    events.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var most = 0, now = 0;
    events.forEach(function (e) { now += e[1]; if (now > most) most = now; });
    for (var upTo = COLORS - 1; upTo >= 0; upTo--) {
      var d = "M" + x(0) + "," + STRIP, running = 0;
      events.forEach(function (e) {
        if (e[2] > upTo) return;
        running += e[1];
        d += "H" + x(e[0]) + "V" + (STRIP - running / most * (STRIP - 16));
      });
      el("path", { d: d + "H" + x(run.wallMs) + "V" + STRIP + "Z", fill: "var(--k" + upTo + ")", "class": "running" }, svg);
    }
    el("text", { x: LEFT + 3, y: 11 }, svg).textContent = "most at once: " + most;

    // What is outlined and joined. With nothing pinned: the critical path. With a bar pinned: the chain of commands
    // this run waited on before it, each joined to the one it was waiting on, and lit, every command it held up.
    var steps = run.bars.filter(function (b) { return b.step !== undefined; }).sort(function (a, b) { return a.step - b.step; });
    var links = [], forward = [], chain = {}, held = {};
    // The join from the bar a bar waited on; the bars it waited on, back to the start of the run.
    var waitedOn = function (b) { return [run.bars[b.blocker], b.readyAt, b]; };
    var chainOf = function (i) { var out = []; for (var at = i; at !== undefined; at = run.bars[at].blocker) out.push(at); return out; };
    if (run.pinned === undefined) {
      // Only steps that follow each other: after incremental builds a run holds some of the path's steps, not all.
      for (var i = 0; i + 1 < steps.length; i++) {
        if (steps[i + 1].step === steps[i].step + 1) links.push([steps[i], steps[i].start + steps[i].blocksNextForMs, steps[i + 1]]);
      }
    } else {
      chainOf(run.pinned).forEach(function (at) {
        chain[at] = true;
        if (run.bars[at].blocker !== undefined) links.push(waitedOn(run.bars[at]));
      });
      var heldUp = {};
      run.bars.forEach(function (b, i) { if (b.blocker !== undefined) (heldUp[b.blocker] = heldUp[b.blocker] || []).push(i); });
      for (var queue = [run.pinned]; queue.length > 0; ) {
        (heldUp[queue.pop()] || []).forEach(function (i) {
          held[i] = true;
          queue.push(i);
          forward.push(waitedOn(run.bars[i]));
        });
      }
    }
    // From where one command released what the next needed, down or up to the next one's row, then along to its
    // start: along the gap between rows, so the line never runs through the bars (and names) of that row.
    var join = function (link, cls, parent) {
      var x1 = x(link[1]), x2 = x(link[2].start);
      var y1 = y(link[0]) + h(link[0]) / 2, to = link[2];
      if (y(link[0]) === y(to)) return;
      var gap = y1 < y(to) ? y(to) - 1 : y(to) + h(to) + 1;
      el("path", { d: "M" + x1 + "," + y1 + "V" + gap + "H" + x2, "class": cls }, parent);
    };
    // Only while a bar is pinned: what is being shown, in numbers the chart does not give.
    run.note.textContent = run.pinned === undefined ? "" :
      run.bars[run.pinned].label + " · waited on " + (Object.keys(chain).length - 1) + " before it · held up " +
      Object.keys(held).length + " · Esc to unpin";

    var outlined = function (b, i) { return run.pinned === undefined ? b.step !== undefined : chain[i]; };
    var lit = function (b, i) { return run.pinned === undefined ? steps.length === 0 : held[i]; };
    // With a bar pinned, what has nothing to do with it all but disappears; otherwise the rest only steps back.
    var away = run.pinned === undefined ? " faded" : " dim";
    run.bars.forEach(function (b, i) {
      el("rect", {
        x: x(b.start), y: y(b), width: barWidth(b), height: h(b), fill: "var(--k" + run.lanes[b.lane].color + ")",
        "class": "bar" + (outlined(b, i) ? " onpath" : lit(b, i) ? "" : away), "data-i": i,
      }, svg);
      if (b.released !== undefined) {
        el("line", { x1: x(b.start + b.released), x2: x(b.start + b.released), y1: y(b), y2: y(b) + h(b), "class": "tickmark" }, svg);
      }
      var fits = chars(b);
      if (fits >= 5 && tall[b.lane][b.row]) {
        var label = b.label.length > fits ? b.label.slice(0, fits - 1) + "…" : b.label;
        var related = outlined(b, i) || lit(b, i) || run.pinned === undefined;
        el("text", { x: x(b.start) + 4, y: y(b) + BAR - 3, "class": related ? "in" : "in dim" }, svg).textContent = label;
      }
    });
    forward.forEach(function (link) { join(link, "join forward", svg); });
    links.forEach(function (link) { join(link, "join", svg); });

    // Under the cursor: the chain the bar waited on, without pinning anything.
    var hoverLayer = el("g", {}, svg), hovered;
    var showChain = function (i) {
      if (i === hovered) return;
      hovered = i;
      hoverLayer.textContent = "";
      if (i !== undefined) chainOf(i).forEach(function (at) {
        var b = run.bars[at];
        el("rect", { x: x(b.start), y: y(b), width: barWidth(b), height: h(b), "class": "hoverbar" }, hoverLayer);
        if (b.blocker !== undefined) join(waitedOn(b), "join hover", hoverLayer);
      });
    };

    svg.addEventListener("mousemove", function (ev) {
      var i = barIndex(ev);
      showChain(i);
      if (i === undefined) { tip.hidden = true; return; }
      var b = run.bars[i];
      tip.textContent = "";
      html("b", b.label, tip);
      html("div", "rule " + b.rule + (b.pool ? " · pool " + b.pool : ""), tip);
      html("div", ms(b.end - b.start) + " · from " + ms(b.start) + " to " + ms(b.end), tip);
      // What it was waiting on, and then how long it sat before starting: the first is dependencies, the second is
      // a full pool or no free job slot.
      if (b.blocker === undefined) html("div", "needed nothing this run made", tip);
      else {
        var blocker = run.bars[b.blocker];
        html("div", "last thing it needed: " + blocker.label +
          (b.readyAt < blocker.end ? " (ready " + ms(b.readyAt - blocker.start) + " into it)" : ""), tip);
        html("div", "started " + ms(b.waited) + " after that was ready", tip);
      }
      if (b.released !== undefined) html("div", "dependents can start after " + ms(b.released), tip);
      if (b.step !== undefined) html("div", "critical path step " + (b.step + 1) + ": holds up the next for " + ms(b.blocksNextForMs), tip);
      if (b.phases.length > 0) html("div", b.phases.map(function (p) { return p[0] + " " + ms(p[1]); }).join(" · "), tip);
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - tw - 8) + "px";
      tip.style.top = (ev.clientY + 18 + th > window.innerHeight ? ev.clientY - th - 10 : ev.clientY + 18) + "px";
    });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; showChain(undefined); });
    svg.addEventListener("click", function (ev) {
      var i = barIndex(ev);
      run.pinned = i === run.pinned ? undefined : i;
      draw(run, host, gutter);
    });
    host.scrollLeft = scrolled;
  }

  var runs = document.getElementById("runs");
  var gutters = [];
  var hosts = data.runs.map(function (run, i) {
    html("h2", (i === 0 ? "most recent run of ninja · " : "earlier run · ") + run.title, runs);
    var sum = run.bars.reduce(function (s, b) { return s + b.end - b.start; }, 0);
    html("div", ms(run.wallMs) + " wall · " + run.bars.length + " commands taking " + ms(sum) + " · " +
      (sum / run.wallMs).toFixed(1) + "× average parallelism", runs, "meta");
    run.note = html("div", undefined, runs, "meta");
    var row = html("div", undefined, runs, "run");
    gutters.push(html("div", undefined, row, "gutter"));
    return html("div", undefined, row, "scroll");
  });
  function plotWidth(host) { return Math.max(320, host.clientWidth) * level - LEFT - RIGHT; }
  function drawAll() { data.runs.forEach(function (run, i) { draw(run, hosts[i], gutters[i]); }); }
  // Zoom every chart, keeping the moment under the cursor (or, away from the cursor, at the middle of the view) still.
  function zoomTo(value, overHost, clientX) {
    var anchors = hosts.map(function (host) {
      var at = host === overHost ? clientX - host.getBoundingClientRect().left : host.clientWidth / 2;
      return { at: at, moment: (host.scrollLeft + at - LEFT) / plotWidth(host) };
    });
    level = Math.min(MOST_ZOOM, Math.max(1, value));
    drawAll();
    hosts.forEach(function (host, i) { host.scrollLeft = LEFT + anchors[i].moment * plotWidth(host) - anchors[i].at; });
  }
  window.addEventListener("resize", drawAll);
  window.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    data.runs.forEach(function (run) { run.pinned = undefined; });
    drawAll();
  });
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
})();
`;
