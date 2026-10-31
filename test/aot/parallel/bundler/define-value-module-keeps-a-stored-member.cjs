// A store to a member of a name whose `--define` value is `module` stores to the module object of the file: a read of the member by the name `module` finds what was stored.
// Flags: --define MOD=module
MOD.id = "changed";
console.log(module.id);
