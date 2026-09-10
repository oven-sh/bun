# Passed after linker.lds on FreeBSD only. crt1.o defines these two symbols
# and libc.so.7 resolves them through the executable's dynamic symbol table.
# They cannot live in linker.lds: lld rejects a version-script name that the
# link does not define, and Linux does not define them.
#
# An exact name in any version node wins over the `local: *` of linker.lds,
# so this node only has to list them.
BUN_FREEBSD {
    global:
	environ;
	__progname;
};
