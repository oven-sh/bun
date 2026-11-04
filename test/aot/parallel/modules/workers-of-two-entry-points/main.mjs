// Two entry points that know nothing of each other, and each starts a Worker from a file of its own. One load serves the two programs, and each reaches its own `new Worker`
// alone: the first took the file of the second for one that nothing starts, and it was not in the executable: no word, exit code 0.
// The executable starts at the second entry point, which says what this one says.
// Entry points: ./second/main.mjs
// Flags: --root=.
// Env of the executable: BUN_AOT_START_AT=second/main.mjs
new Worker(new URL("./job.mjs", import.meta.url));
