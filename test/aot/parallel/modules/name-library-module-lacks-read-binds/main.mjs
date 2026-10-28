// One file binds a name that node:fs does not have, and fails to link. Another file reads the same name off the namespace object: undefined, as any value.
try {
  await import("./binds-the-name.mjs");
} catch (error) {
  console.log(error.name);
}
await import("./reads-the-name.mjs");
