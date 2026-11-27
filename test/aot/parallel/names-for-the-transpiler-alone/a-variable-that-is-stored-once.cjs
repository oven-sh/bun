// `bun run` puts no `let` in the place of its name, so the loader of the run time is asked for "bun:os", which it does not know.
let loose = "bun:os";
try {
  console.log(typeof require(loose).EOL);
} catch (error) {
  console.log(error.code);
}
