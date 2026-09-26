#!/usr/bin/env python3
"""Append an ad-hoc Apple code signature for the whole image file to the image.

Apple Silicon maps file pages executable only if a code signature covers them.
The macOS host (host/host_posix.c) registers this signature with
fcntl(F_ADDFILESIGS_RETURN) and then maps the segments from the file. The
signature has the layout that probe/apple_signed_map.c tested on macOS arm64:
a SuperBlob with one CodeDirectory, SHA-256 over 4 KiB pages, ad-hoc.

    apple_sign.py <image>            sign in place
    apple_sign.py --blob <file>      print the signature of <file> as it is (for tests)

File after signing:
    image | zeros up to a multiple of 16 KiB | signature | trailer
    trailer: 5 x u64, little endian: code_off (0), code_len, sig_off, sig_len, MAGIC

Every other host ignores what follows the ELF data. Sign last: any change to
the first code_len bytes makes the signature wrong.
"""
import hashlib
import struct
import sys

HASH_PAGE = 4096
ALIGN = 16384  # page size of macOS on arm64
MAGIC = struct.unpack("<Q", b"BUNSIG01")[0]
IDENT = b"bun.portable.image\0"
TRAILER = struct.Struct("<5Q")


def signature(code):
    slots = (len(code) + HASH_PAGE - 1) // HASH_PAGE
    ident_off = 88
    hash_off = ident_off + len(IDENT)
    cd_len = hash_off + 32 * slots
    assert len(code) < 1 << 32, "codeLimit is 32 bits here"
    directory = struct.pack(
        ">9I4B4IQ3Q",
        0xFADE0C02, cd_len, 0x20400,  # magic, length, version
        0x20002,  # flags: adhoc, linker-signed
        hash_off, ident_off,
        0, slots,  # special slots, code slots
        len(code),  # codeLimit
        32, 2, 0, 12,  # hash size, hash type SHA-256, platform, log2(hash page)
        0, 0, 0, 0,  # spare2, scatterOffset, teamOffset, spare3
        0,  # codeLimit64
        0, len(code), 0,  # execSegBase, execSegLimit, execSegFlags
    )
    assert len(directory) == ident_off
    hashes = b"".join(hashlib.sha256(code[at:at + HASH_PAGE]).digest() for at in range(0, len(code), HASH_PAGE))
    # SuperBlob: magic, length, count, then (type 0 = CodeDirectory, offset 20).
    return struct.pack(">5I", 0xFADE0CC0, 20 + cd_len, 1, 0, 20) + directory + IDENT + hashes


def sign(path):
    data = open(path, "rb").read()
    if len(data) >= TRAILER.size and TRAILER.unpack(data[-TRAILER.size:])[4] == MAGIC:
        data = data[:TRAILER.unpack(data[-TRAILER.size:])[1]]  # signed before: sign again
    code = data + bytes(-len(data) % ALIGN)
    blob = signature(code)
    with open(path, "wb") as f:
        f.write(code + blob + TRAILER.pack(0, len(code), len(code), len(blob), MAGIC))
    print(f"signed {path}: {len(code)} bytes covered, signature {len(blob)} bytes")


if len(sys.argv) == 3 and sys.argv[1] == "--blob":
    sys.stdout.buffer.write(signature(open(sys.argv[2], "rb").read()))
elif len(sys.argv) == 2:
    sign(sys.argv[1])
else:
    sys.exit(__doc__)
