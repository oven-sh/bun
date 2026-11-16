// What the compiler reads in place of src/js/internal/desktop/electron/aliases.ts, which `bun run` evaluates. A compiled
// program has no plugins: it asks for `bun:desktop/electron` and `node:fs` by those names.
// Written against that file with the SHA-256 3871b7412437bab7d38c5279e5558b591e108715ebf56e47fdf715e274dd00ac.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.
export default function provide(_electron: object) {}
