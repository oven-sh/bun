#!/usr/bin/env python3
"""Checks the Apple code signature that tools/apple_sign.py appended to an image.

    check_signature.py <image>

Reads the file the way the macOS host does (trailer at the end), then the
signature field by field (xnu osfmk/kern/cs_blobs.h), and hashes every page.
It does not use the code of apple_sign.py. It cannot tell whether macOS
accepts the signature: that needs a Mac.
"""
import hashlib
import struct
import sys

data = open(sys.argv[1], "rb").read()


def need(condition, what):
    if not condition:
        sys.exit(f"{sys.argv[1]}: {what}")


code_off, code_len, sig_off, sig_len, magic = struct.unpack("<5Q", data[-40:])
need(magic == struct.unpack("<Q", b"BUNSIG01")[0], "no trailer")
need(code_off == 0 and code_len % 16384 == 0, "the signed range is not whole 16 KiB pages from offset 0")
need(sig_off == code_len and sig_off + sig_len + 40 == len(data), "signature and trailer do not follow the signed range")
blob = data[sig_off:sig_off + sig_len]

sb_magic, sb_length, sb_count, slot_type, slot_offset = struct.unpack(">5I", blob[:20])
need((sb_magic, sb_length, sb_count, slot_type, slot_offset) == (0xFADE0CC0, sig_len, 1, 0, 20), "SuperBlob header")
cd = blob[20:]
(cd_magic, cd_length, version, flags, hash_offset, ident_offset, special_slots, code_slots, code_limit,
 hash_size, hash_type, platform, page_log2, spare2, scatter, team, spare3, code_limit64,
 exec_base, exec_limit, exec_flags) = struct.unpack(">9I4B4IQ3Q", cd[:88])
need(cd_magic == 0xFADE0C02 and cd_length == len(cd), "CodeDirectory magic or length")
need(version == 0x20400 and flags == 0x20002, "version or flags")
need((hash_size, hash_type, page_log2) == (32, 2, 12), "not SHA-256 over 4 KiB pages")
need(special_slots == 0 and code_slots == code_len // 4096 and code_limit == code_len, "slots or codeLimit")
need((platform, spare2, scatter, team, spare3, code_limit64) == (0, 0, 0, 0, 0, 0), "a field that has to be 0")
need((exec_base, exec_limit, exec_flags) == (0, code_len, 0), "execSeg fields")
need(cd[ident_offset:hash_offset] == b"bun.portable.image\0", "identifier")
need(hash_offset + 32 * code_slots == len(cd), "size of the hash table")
for i in range(code_slots):
    need(hashlib.sha256(data[4096 * i:4096 * (i + 1)]).digest() == cd[hash_offset + 32 * i:hash_offset + 32 * (i + 1)], f"hash of page {i}")

# What the host maps from the file has to be inside the signed range.
need(data[:4] == b"\x7fELF", "not an ELF file")
phoff, = struct.unpack_from("<Q", data, 32)
phentsize, phnum = struct.unpack_from("<HH", data, 54)
mapped = 0
for i in range(phnum):
    p_type, p_flags, p_offset, p_vaddr, _, p_filesz, p_memsz, _ = struct.unpack_from("<IIQQQQQQ", data, phoff + i * phentsize)
    if p_type == 1 and not p_flags & 2:
        end = p_offset + (p_memsz + 16383 & ~16383)
        need(p_offset % 16384 == 0 and end <= code_len, f"segment {i} leaves the signed range")
        mapped += 1
print(f"{sys.argv[1]}: signature covers {code_len} bytes in {code_slots} pages, all hashes match, {mapped} mapped segments are inside")
