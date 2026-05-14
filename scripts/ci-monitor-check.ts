#!/usr/bin/env bun
// Check the latest claude/phase-a-port CI build for [new] failures.
// If found and build has enough jobs passed, emit JSON args for ci-auto-fix-v2.js.
// State in /tmp/ci-monitor-state.json prevents re-launching for the same build.

import { $ } from "bun";

const STATE_PATH = "/tmp/ci-monitor-state.json";
const MIN_PASSED = 80; // wait until enough test-bun jobs have run
type State = { last_build: number; launched_for: number[]; stuck: string[] };

const state: State = await Bun.file(STATE_PATH)
  .json()
  .catch(() => ({ last_build: 0, launched_for: [], stuck: [] }));

// latest build on the branch
const builds = await fetch(
  `https://api.buildkite.com/v2/organizations/bun/pipelines/bun/builds?branch=claude/phase-a-port&per_page=1`,
  { headers: { Authorization: `Bearer ${process.env.BUILDKITE_API_TOKEN}` } },
).then(r => r.json());
const b = builds[0];
if (!b) {
  console.error(JSON.stringify({ action: "noop", reason: "no builds" }));
  process.exit(0);
}

const passed = b.jobs.filter((j: any) => j.state === "passed").length;
const failed = b.jobs.filter((j: any) => j.state === "failed").length;
const running = b.jobs.filter((j: any) => j.state === "running").length;

if (passed < MIN_PASSED) {
  console.error(JSON.stringify({ action: "wait", build: b.number, passed, failed, running }));
  process.exit(0);
}
if (state.launched_for.includes(b.number)) {
  console.error(JSON.stringify({ action: "skip", build: b.number, reason: "already launched" }));
  process.exit(0);
}

// parse [new] failures from ci:errors
const errorsTxt = await $`bun scripts/find-build.ts --errors ${b.number}`.text().catch(() => "");
const lines = errorsTxt.split("\n");
const failures: { test: string; platform: string; symptom: string }[] = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^== (.+?) == \[new\]$/);
  if (!m) continue;
  const test = m[1];
  // next non-empty line is "-- <test> - <symptom> on <platform>"
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    const d = lines[j].match(/^-- .+? - (.+?) on (.+)$/);
    if (d) {
      failures.push({ test, symptom: d[1], platform: d[2] });
      break;
    }
  }
}

if (failures.length === 0) {
  console.error(JSON.stringify({ action: "clean", build: b.number, passed, failed }));
  process.exit(0);
}

state.launched_for.push(b.number);
state.last_build = b.number;
await Bun.write(STATE_PATH, JSON.stringify(state));

// emit args for the workflow on stdout
console.log(JSON.stringify({ build: b.number, failures }));
console.error(JSON.stringify({ action: "launch", build: b.number, count: failures.length, passed, failed }));
