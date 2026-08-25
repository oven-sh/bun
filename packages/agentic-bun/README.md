# agentic-bun

A thin Bun CLI that turns a few plain-text answers into one or more **Claude Code**
agents running against a **local Ollama model**, via `ollama launch claude`.

It is a dispatcher, not an agent runtime. There is no tool-calling loop, no planner
object, no memory store. Each agent is a real `claude` process, so file editing, shell
access and web fetch come from Claude Code's own harness. This project owns exactly
four things: the wizard, the prompts, process fan-out, and the report at the end.

```
wizard / flags ─► one prompt per agent ─► N × ollama launch claude -- -p "<prompt>" ─► prefixed live output ─► summary
```

## Requirements

- **Bun** 1.1+ (developed on 1.3.11).
- **Ollama** 0.14.0+ for the Anthropic-compatible API; **0.15+** for the `ollama launch`
  subcommand this tool drives. Check with `ollama --version`. If `ollama launch` errors
  with `unknown command`, upgrade Ollama.
- **At least one pulled model**: `ollama pull qwen2.5-coder:7b`.
- `ollama launch claude` installs/launches the Claude Code CLI and sets
  `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` for it. With
  `--direct` this tool sets those itself and runs `claude` directly, which needs the
  `claude` CLI on `PATH`.

## Dependencies

**Zero.** Nothing is installed; `package.json` has no `dependencies` or
`devDependencies` field at all. Subprocesses use `Bun.spawn`, questions use the built-in
`node:readline/promises`, and the tests use `bun:test`.

## Install

```sh
cd packages/agentic-bun
bun link                 # optional: puts `agentic-bun` on your PATH
bun run src/cli.ts --help
```

## Usage

```sh
# Interactive: three to five questions, then it runs.
agentic-bun

# One agent, no questions.
agentic-bun -y -g "explain what src/resolver does" -m qwen2.5-coder:7b

# Three agents; the model splits the goal into three tasks first.
agentic-bun -y -g "add streaming to the CSV reader" -n 3

# Three agents, tasks you wrote yourself, two at a time.
agentic-bun -t "implement the reader" -t "write tests" -t "update the docs" -c 2

# Let the agents actually edit files, and pass anything else straight to claude.
agentic-bun -g "fix the lint errors" -n 2 --permission-mode acceptEdits -- --verbose

# See the exact commands without running anything.
agentic-bun --dry-run -g "..." -n 2

# Machine-readable: captures output instead of streaming it.
agentic-bun --json -y -g "audit the error paths" -n 4 > report.json
```

Run `agentic-bun --help` for the full flag list.

### Notes on behaviour

- **Headless by default.** Every agent runs as `claude -p <prompt>`, so it never waits
  for terminal input. By default Claude Code will refuse tool calls that need
  permission; pass `--permission-mode acceptEdits` (or `bypassPermissions`) if you want
  the agents to change files.
- **Agents share one working tree.** Each agent's prompt lists the other agents' tasks
  and tells it to stay in its lane and not to commit, push, or run repo-wide destructive
  commands. That is a prompt-level convention, not a sandbox — give unrelated tasks to
  unrelated directories if you need real isolation.
- **Concurrency** defaults to `min(agents, 4)`; override with `-c`.
- **Timeouts:** each agent is killed after `--timeout` seconds (default 900) and reported
  as `timeout`.
- **Exit code** is 0 only if every agent exited 0. Ctrl-C terminates all live agents.
- Nothing is written to disk, no session is saved, and the process exits when the last
  agent does.

## Which `ollama launch` flags were verified

**None on the build machine.** Ollama could not be installed in the environment this was
developed in (no `ollama` binary, and the outbound proxy blocks `ollama.com`), so
`ollama launch --help` was never run against a real install. Rather than hard-code the
flags from the spec, the tool **probes at startup** and adapts:

| Probe                  | What it does                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ollama --version`     | Warns if older than 0.14.0.                                                                                                                                                         |
| `ollama launch --help` | If the subcommand is missing, exits with an upgrade hint. `--model` and `--yes` are only passed if the help text advertises them; if either is missing you get a `note:` on stderr. |
| `ollama list`          | Auto-selects the model when exactly one is installed; otherwise offers a numbered list.                                                                                             |

`-- <args>` passthrough is used unconditionally (with a `note:` if the help text does not
document it), because there is no way to detect it other than trying. If a future Ollama
changes the surface further, `--direct` skips `ollama launch` entirely and runs `claude`
against `$OLLAMA_HOST` (default `http://localhost:11434`) with the Anthropic-compatible
environment variables set locally.

**Verified on the build machine:** the `claude` flags used (`-p`, `--model`,
`--permission-mode`) exist on Claude Code 2.1.243.

## Test transcript

Ollama is unavailable here, so this run uses `test/fixtures/ollama-stub.sh` — a stub that
answers `--version` / `list` / `launch --help` like the real CLI, records the argv it was
launched with, and prints a canned agent reply. It exercises the whole tool; only the
model is fake. (The stub's absolute path is shortened to `ollama` below; the tool prints
the resolved binary path.)

```console
$ agentic-bun --dry-run -g "add streaming to the CSV reader" \
    -t "implement the streaming reader" -t "write tests for it"
note: using the only installed model, qwen2.5-coder:7b.
# a1: implement the streaming reader
ollama launch claude --model qwen2.5-coder:7b --yes -- -p 'You are agent 1 of 2 working in parallel on one shared objective.

OBJECTIVE
add streaming to the CSV reader

YOUR TASK
implement the streaming reader

TASKS OWNED BY THE OTHER AGENTS (do not do these)
  2. write tests for it

RULES
- Work inside /tmp/demo.
- Do only your task. If your task needs something another agent owns, assume it will exist and note the assumption in your summary instead of doing their work.
- The other agents are editing this same working tree right now. Do not run repo-wide destructive commands (git checkout/reset/clean/stash, mass reformat, dependency reinstall) and do not commit or push.
- Prefer edits scoped to the files your task names.

When you are finished, print a short summary: what you changed, which files you touched, and anything you could not do.'

# a2: write tests for it
ollama launch claude --model qwen2.5-coder:7b --yes -- -p 'You are agent 2 of 2 ...'

$ agentic-bun -g "add streaming to the CSV reader" \
    -t "implement the streaming reader" -t "write tests for it"
note: using the only installed model, qwen2.5-coder:7b.
Running 2 agent(s) in /tmp/demo on qwen2.5-coder:7b (concurrency 2).
[a1] edited src/csv.ts; all tests pass
[a2] edited src/csv.ts; all tests pass

Summary
  a1   ok             0.0s  implement the streaming reader
  a2   ok             0.0s  write tests for it
  2/2 agents succeeded.
```

Interactive wizard, same stub, under a real pty:

```console
$ agentic-bun
What do you want done? add tests for the parser
Which directory should the agents work in? [/tmp/demo]
How many agents should run in parallel? [1] 2
Describe each agent's task, one per line. Press Enter on an empty line to let the model split the goal for you.
  agent 1: cover the happy path
  agent 2: cover the error path
Installed models:
  1. qwen2.5-coder:7b
  2. glm-4.7-flash
Which model? [1] 2
Running 2 agent(s) in /tmp/demo on glm-4.7-flash (concurrency 2).
[a1] agent finished
[a2] agent finished

Summary
  a1   ok             0.0s  cover the happy path
  a2   ok             0.0s  cover the error path
  2/2 agents succeeded.
```

**Not yet verified end to end against a real Ollama install.** Everything above the model
boundary is exercised by the tests; the one unverified step is whether the installed
`ollama launch` accepts the flags in the order this tool emits them.

## Tests

```sh
cd packages/agentic-bun
bun test test/            # 42 tests
```

No debug build of Bun is needed — this package is plain TypeScript and never calls into
Bun's native code, so it runs on the system `bun` (same exception the repo makes for
`packages/bun-types`).

- `test/unit.test.ts` — version/model/help parsing, command construction for both launch
  and direct modes, prompt contents, plan parsing, argument parsing.
  `tsc --noEmit` was **not** run: this checkout has no `node_modules`, so
  `@types/node` cannot resolve. Run `bun install` at the repo root first if you want
  to typecheck.

- `test/cli.test.ts` — the CLI end to end against the stub: preflight failures, dry runs,
  streaming with per-agent prefixes, `--json` reports, timeouts, the wizard, and
  concurrency. The concurrency tests are timing-free: the stub blocks until N agents are
  alive at once, so parallel runs pass and serialized runs deliberately do not.

## Files

| File            | Purpose                                                            |
| --------------- | ------------------------------------------------------------------ |
| `src/cli.ts`    | Flags, wizard, preflight, planning call, summary. Read this first. |
| `src/ollama.ts` | Probing the local Ollama install.                                  |
| `src/plan.ts`   | Prompt strings and parsing the model's task list.                  |
| `src/runner.ts` | Spawning the agents, the concurrency pool, output multiplexing.    |

## Scope note

The original handoff brief for this tool listed multi-agent orchestration as a non-goal
and asked for a single-shot dispatcher. The request this was built against asked for
multiple agents, so fan-out was added: a concurrency pool, per-agent prompts and a
combined report. The brief's real constraint is intact — there is still no agent loop,
planner or tool framework here, only N invocations of a harness that already exists.
