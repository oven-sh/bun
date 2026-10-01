# The inputs of the parse_isolated_entity_name comparison: hand-picked texts and 6000 seeded random token strings, one hex-encoded text per line.
import binascii, random, sys
random.seed(28301)
fixed = [
 b"", b"React", b"React.createElement", b"h", b"a.b.c", b"a..b", b"a.", b".a", b"1", b"a b", b"a.#b", b"#a", b"#a.b", b"this", b"this.x", b"a.this",
 b"a.<", b"a.<b", b"a\n.b", b"a.\nb", b"a.\nb c", b"a.\nb\nc", b"a.\n b.c", b"React . createElement", b" React.createElement ", b"null", b"a.b()", b"a-b", b"\\u0061.b",
 b"a.\\u0062", b"\\u{61}bc.d", b"a/**/.b", b"a//x\n.b", b"a.b//x", b"/* c */a", b"default", b"a.default", b"class.if.else", b"await", b"a.await", b"yield.x",
 b"a.b.", b"a.b..c", b"a.1", b"a.1b", b"1.a", b"a[0]", b"a?.b", b"a!.b", b"a.b!", b"<a>", b"a<b>", b"a.b<c>", b"\xc3\xa9.b", b"a.\xe4\xb8\xad", b"\xff", b"a.\xff", b"a\x00", b"a\r\n.b",
 b"a.\r\nb", b"a .\tb", b"_", b"$", b"$.a", b"a.$", b"a._", b"A.B.C.D.E.F.G", b"a.b c.d", b"import.meta", b"new.target", b"super.x", b"a.super", b"true.false", b"a.#", b"#", b"a#b",
 b"@jsx", b"a.@b", b"'a'", b"a.'b'", b"`a`", b"a.`b`", b"a,b", b"a;b", b"a.b;", b"(a)", b"a.(b)", b"a\\", b"\\", b"a.\\u00", b"\\u0030a", b"a\\u0030", b"a.b\n", b"\na.b", b"a.b\n\n", b"a\n", b"a.\n", b"a.\nb.\nc", b"a.\nif\nelse",
 b"a.\nb\tc", b"a.\nb.c d", b"a.\n\nb c", b"a. b c", b"a.b\nc", b"x.\ny z w", b"a.\n#b", b"a.\n<", b"a.\nb<", b"jsx.h", b"preact.h", b"React.Fragment", b"Fragment", b"a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p",
 b"<!--a", b"-->a", b"a<!--", b"a.-->", b"#!a", b"a/*", b"a./*", b"a.b/*\n*/.c", b"a\xe2\x80\xa8.b", b"a.\xe2\x80\xa8b c", b"a\xc2\xa0.b", b"\xef\xbb\xbfa.b", b"a.b\xef\xbb\xbf",
 b"0x1.a", b"a.0x1", b"1n", b"a.1n", b"\"a\".b", b"/a/.b", b"a./b/", b"a.b/c", b"a.=b", b"a=b", b"a.b=", b"...a", b"a...b", b"a.. .b", b"a?b", b"a??b", b"a&&b", b"abstract.any.as.asserts", b"of.in.is.keyof", b"undefined.void.with",
]
toks = [b"a", b"b", b"React", b"createElement", b"h", b"this", b"if", b"default", b"await", b"yield", b"#p", b".", b".", b".", b".", b" ", b"\n", b"\t", b"\r\n", b"<", b">", b"1", b"0x", b"/**/", b"//c\n", b"\\u0061", b"\\u{62}", b"\xc3\xa9", b"$", b"_", b"(", b")", b"?.", b"!", b"-", b"'s'", b"`t`", b",", b";", b"@", b"\\", b"#", b"null", b"type", b"of", b"\xe2\x80\xa8", b"/", b"*", b"="]
inputs = list(fixed)
for _ in range(6000):
    n = random.choice([1, 2, 3, 3, 4, 5, 6, 7, 9, 12])
    parts = []
    for i in range(n):
        if random.random() < 0.55:
            parts.append(random.choice([b"a", b"b", b"React", b"createElement", b"h", b"this", b"if", b"default", b"#p", b"\\u0061", b"\xc3\xa9", b"$", b"_"]))
            if random.random() < 0.7:
                parts.append(random.choice([b".", b".", b".", b" . ", b".\n", b"\n.", b". "]))
        else:
            parts.append(random.choice(toks))
    inputs.append(b"".join(parts))
sys.stdout.write("\n".join(binascii.hexlify(i).decode() for i in inputs) + "\n")
