// tui_* features: a full-screen terminal UI on a pty. tui_core is raw-mode
// stdin with keypress parsing, the alternate screen, cursor and erase escapes,
// frame diffing, a spinner timer and scripted typing; each of the others
// switches on one more behaviour (ANSI-aware width, wrap and slice, markdown
// colouring, a streaming reply, SIGWINCH, bracketed paste, cursor keys, lowering
// the JIT thresholds once interactive, process.title). Ctrl-D or the 3 s budget
// ends it.
export const features = {
  core: 1,
  width: 1,
  wrap: 1,
  slice: 1,
  md: 1,
  stream: 1,
  resize: 1,
  paste: 1,
  keys: 1,
  jit: 1,
  title: 1,
};
export async function run(selected) {
  const on = new Set(selected);
  const readline = (await import("node:readline")).default;
  const T0 = performance.now();
  const BUDGET = 3000;
  const out = process.stdout,
    inp = process.stdin;
  if (!out.isTTY || !inp.isTTY) throw new Error("the tui features need a terminal");
  let cols = out.columns || 100,
    rows = out.rows || 30;
  const ESC = "\x1b[",
    w = s => out.write(s);
  const color = (c, s) => `\x1b[${c}m${s}\x1b[39m`,
    bold = s => `\x1b[1m${s}\x1b[22m`,
    dim = s => `\x1b[2m${s}\x1b[22m`,
    inverse = s => `\x1b[7m${s}\x1b[27m`,
    rgb = (r, g, b, s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`,
    link = (u, s) => `\x1b]8;;${u}\x07${s}\x1b]8;;\x07`;
  const width = on.has("width") ? s => Bun.stringWidth(s) : s => s.length;
  const wrap = on.has("wrap") ? (s, n) => Bun.wrapAnsi(s, n, { hard: true, trim: false }) : s => s;
  const slice = on.has("slice") ? (s, a, b) => Bun.sliceAnsi(s, a, b) : (s, a, b) => s.slice(a, b);
  const pad = (s, n) => {
    const k = width(s);
    return k >= n ? slice(s, 0, n) : s + " ".repeat(n - k);
  };
  const box = (title, lines, n) => [
    color(36, "╭─ " + bold(title) + " " + "─".repeat(Math.max(0, n - width(title) - 5)) + "╮"),
    ...lines.map(l => color(36, "│") + pad(l, n - 2) + color(36, "│")),
    color(36, "╰" + "─".repeat(n - 2) + "╯"),
  ];
  const state = {
    messages: [],
    input: "",
    cursor: 0,
    spinner: 0,
    streaming: null,
    keys: 0,
    typed: 0,
    pastes: 0,
    resizes: 0,
    history: [],
    scroll: 0,
  };
  const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const REPLY =
    "Here is a **plan**: I'll create `index.html`, `style.css` and `app.js`. 日本語のテキストも表示します 👩‍💻 ✓ — then run the tests.\n\n```js\nfunction greet(name) {\n  return `hello ${name}`;\n}\n```\n\n- step one: read the files\n- step two: edit `app.js` ✏️\n- step three: run `bun test` 🧪\n\nSee https://example.com/docs for details. ".repeat(
      2,
    );
  const md = on.has("md")
    ? line =>
        line
          .replace(/\*\*([^*]+)\*\*/g, (_, t) => bold(t))
          .replace(/`([^`]+)`/g, (_, t) => color(33, t))
          .replace(/^- /, color(35, "• "))
          .replace(/(https?:\/\/\S+)/g, u => link(u, color(34, u)))
    : line => line;
  function renderMessages(n) {
    const lines = [];
    for (const m of state.messages.slice(-12)) {
      const head = m.role === "user" ? color(32, "> ") : rgb(215, 119, 87, "● ");
      const body = wrap(m.text.split("\n").map(md).join("\n"), n - 4).split("\n");
      body.forEach((l, i) => lines.push((i ? "  " : head) + l));
      if (m.tool) lines.push("  " + dim("⎿  ") + color(90, `${m.tool} (${m.ms}ms)`) + " " + color(32, "✓"));
      lines.push("");
    }
    return lines;
  }
  let prev = [];
  function frame() {
    const n = Math.min(cols, 120);
    const header = inverse(
      pad(
        ` ${bold("orderfile tui")}  ${dim(new Date().toISOString())}  ${SPIN[state.spinner % SPIN.length]}  keys=${state.keys} pastes=${state.pastes}`,
        n,
      ),
    );
    const msgs = renderMessages(n);
    const inputLines = box(
      "prompt",
      [
        color(37, "❯ ") +
          state.input.slice(0, state.cursor) +
          inverse(state.input[state.cursor] ?? " ") +
          state.input.slice(state.cursor + 1),
      ],
      n,
    );
    const status = dim(
      pad(`  ? for shortcuts · ${state.messages.length} messages · ${cols}x${rows} · resizes ${state.resizes}`, n),
    );
    const all = [header, ...msgs.slice(-(rows - 6)), ...inputLines, status];
    let buf = ESC + "?2026h";
    for (let i = 0; i < Math.max(all.length, prev.length); i++) {
      if (all[i] !== prev[i]) buf += ESC + (i + 1) + ";1H" + ESC + "2K" + (all[i] ?? "");
    }
    buf += ESC + "?2026l";
    prev = all;
    w(buf);
  }
  function submit() {
    const text = state.input.trim();
    state.history.push(text);
    state.input = "";
    state.cursor = 0;
    if (!text) return;
    state.messages.push({ role: "user", text });
    if (!on.has("stream")) {
      state.messages.push({ role: "assistant", text: REPLY, tool: "Read", ms: 12 });
      return;
    }
    let i = 0;
    state.streaming = setInterval(() => {
      if (i === 0) state.messages.push({ role: "assistant", text: "" });
      const last = state.messages.at(-1);
      last.text = REPLY.slice(0, (i += 7));
      if (i >= REPLY.length) {
        clearInterval(state.streaming);
        state.streaming = null;
        last.tool = ["Read", "Write", "Bash"][state.messages.length % 3];
        last.ms = (i * 13) % 900;
      }
      frame();
    }, 8);
  }
  let done = false;
  const { promise: finished, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers();
  function onKey(str, key = {}) {
    state.keys++;
    if (key.ctrl && (key.name === "d" || key.name === "c")) return finish();
    if (key.name === "return") submit();
    else if (key.name === "backspace") {
      state.input = state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor);
      state.cursor = Math.max(0, state.cursor - 1);
    } else if (key.name === "left") state.cursor = Math.max(0, state.cursor - 1);
    else if (key.name === "right") state.cursor = Math.min(state.input.length, state.cursor + 1);
    else if (key.name === "up") {
      state.input = state.history.at(-1) ?? "";
      state.cursor = state.input.length;
    } else if (key.name === "escape") state.input = "";
    else if (str && !key.ctrl && !key.meta) {
      state.input = state.input.slice(0, state.cursor) + str + state.input.slice(state.cursor);
      state.cursor += str.length;
    }
    frame();
  }
  function finish() {
    if (done) return;
    done = true;
    clearInterval(spin);
    clearInterval(auto);
    if (state.streaming) clearInterval(state.streaming);
    w((on.has("paste") ? ESC + "?2004l" : "") + ESC + "?25h" + ESC + "?1049l");
    inp.setRawMode(false);
    inp.pause();
    inp.removeAllListeners("keypress");
    inp.removeAllListeners("data");
    console.log(
      `tui: ${state.keys} keys (${state.typed} typed), ${state.messages.length} messages, ${state.resizes} resizes, ${((performance.now() - T0) / 1000).toFixed(1)} s`,
    );
    // The script below types into the stream itself. Whoever runs this types too (the
    // generator does, through its terminal): none of that arriving means the terminal is not wired up.
    if (state.typed) resolveDone();
    else rejectDone(new Error("nothing typed into the terminal arrived"));
  }
  w(ESC + "?1049h" + ESC + "?25l" + (on.has("paste") ? ESC + "?2004h" : "") + ESC + "2J");
  inp.setRawMode(true);
  readline.emitKeypressEvents(inp);
  inp.setEncoding("utf8");
  inp.on("keypress", onKey);
  let scripted = false;
  inp.on("data", d => {
    if (!scripted) state.typed += d.length;
    if (d.includes("\x1b[200~")) state.pastes++;
  });
  inp.on("end", () => {});
  inp.resume();
  if (on.has("resize")) {
    process.on("SIGWINCH", () => {
      cols = out.columns || cols;
      rows = out.rows || rows;
      state.resizes++;
      prev = [];
      frame();
    });
    out.on("resize", () => {
      state.resizes++;
    });
  }
  const spin = setInterval(() => {
    state.spinner++;
    frame();
  }, 50);
  const script = ["create a simple website\r"];
  if (on.has("keys")) script.push("\x1b[A", "\x1b[D\x1b[D\x7f", "\r", "\x1b");
  if (on.has("paste")) script.push("\x1b[200~pasted text 日本語\x1b[201~", "\r");
  script.push("list the files 👀\r", "run the tests\r");
  let si = 0;
  const auto = setInterval(() => {
    if (si < script.length) {
      scripted = true;
      inp.emit("data", script[si++]);
      scripted = false;
    } else if (si++ === script.length && on.has("resize")) process.kill(process.pid, "SIGWINCH");
    if (performance.now() - T0 > BUDGET) finish();
  }, 250);
  frame();
  if (on.has("jit"))
    try {
      Bun.unsafe?.setJITPolicy?.(1);
    } catch {}
  if (on.has("title")) process.title = "orderfile-tui";
  await finished;
}
