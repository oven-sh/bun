#!/usr/bin/env bun
// Test fixture: stands in for uname(1), so that the branches of the shell
// header can be run on this machine (the aarch64 container, the macOS branch,
// an unknown system). BUN_FAKE_UNAME_S and BUN_FAKE_UNAME_M say what to
// answer. The packed file itself never knows the difference: it calls
// uname -s and uname -m and nothing else.
const flag = process.argv[2] ?? "-s";
const s = process.env.BUN_FAKE_UNAME_S ?? "Linux";
const m = process.env.BUN_FAKE_UNAME_M ?? "x86_64";
process.stdout.write((flag === "-m" ? m : s) + "\n");
