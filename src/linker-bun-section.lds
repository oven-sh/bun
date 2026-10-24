/*
 * Passed with -T to every ELF link. INSERT keeps lld's default layout and only
 * moves `.bun` after `.bss`; lld gives a PROGBITS section that follows NOBITS a
 * PT_LOAD of its own. The --compile payload exe_format/elf.rs appends to that
 * segment therefore never makes the runtime's `.bss` file-backed.
 */
SECTIONS {
	.bun : { KEEP(*(.bun)) }
}
INSERT AFTER .bss;
