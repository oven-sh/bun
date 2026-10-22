try {
  Bun.resolveSync("./no-such-module-here", import.meta.dir);
} catch (error) {
  console.log(error.name, typeof error.message, error.code, error.specifier, typeof error.referrer, error.importKind, error.level, typeof error.position, typeof error.toString(), typeof error.toJSON());
}
