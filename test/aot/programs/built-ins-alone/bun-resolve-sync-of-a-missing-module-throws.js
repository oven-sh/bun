try {
  Bun.resolveSync("./no-such-module-here", import.meta.dir);
} catch (error) {
  console.log(typeof error, typeof error.message);
}
