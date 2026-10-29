// `bun build` reads `this`, `import.meta` and a member of `null` where a defined name is written, and replaces the file's own `this`. None of them is a path of globals: --aot names each such --define and --drop and builds nothing.
// Flags: --define=this.mode="test" --define=SELF=this --define=META=import.meta.env --define=BROKEN=null.member --drop=this.trace
console.log(this.mode, SELF, META, BROKEN);
/* Build errors:
error: TS100050: --aot does not support --define BROKEN=null.member
error: TS100050: --aot does not support --define META=import.meta.env
error: TS100050: --aot does not support --define SELF=this
error: TS100050: --aot does not support --define this.mode="test"
error: TS100050: --aot does not support --drop=this.trace
*/
