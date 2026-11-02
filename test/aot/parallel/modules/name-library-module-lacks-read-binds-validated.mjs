// One file binds a name that node:fs does not have, and fails to link. Another file reads the same name off the namespace object: undefined, as any value.
// Flags: --aot-validate
try {
  await import("./name-library-module-lacks-read-binds/binds-the-name.mjs");
} catch (error) {
  console.log(error.name);
}
await import("./name-library-module-lacks-read-binds/reads-the-name.mjs");
