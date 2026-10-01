import gdb
def dump(name):
    t = gdb.lookup_type(name)
    fs = sorted([(f.bitpos // 8, f.type.sizeof, f.name) for f in t.fields()], key=lambda x: x[0])
    print(name, "sizeof", t.sizeof, "fields", len(fs))
    end = 0
    holes = 0
    for off, size, fname in fs:
        if off > end:
            print("  HOLE at", end, "size", off - end)
            holes += off - end
        end = max(end, off + size)
    if t.sizeof > end:
        print("  TAIL PADDING at", end, "size", t.sizeof - end)
        holes += t.sizeof - end
    print("  total holes", holes)
    small = [(off, size, fname) for off, size, fname in fs if size <= 2]
    print("  small fields:", len(small), "first", small[:3], "last", small[-3:])
dump("bun_js_parser::p::P<true, false>")
dump("bun_js_parser::parser::FnOrArrowDataParse")
dump("bun_js_parser::lexer::Lexer")
