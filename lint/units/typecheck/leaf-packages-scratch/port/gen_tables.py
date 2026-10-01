#!/usr/bin/env python3
# Converts the generated Unicode tables of typescript-go's internal/stringutil into the Rust tables of
# src/typecheck/stringutil, and prints the places where Go's own unicode package (fold.txt, from gofold/main.go)
# differs from what these tables give.
# usage: gen_tables.py <out dir> [fold.txt]
import re
import sys

REF = "/workspace/ref/typescript-go/internal/stringutil/"
COMMIT = "89d5d5b"


def unescape(s):
    out = []
    i = 0
    while i < len(s):
        if s[i] == "\\":
            if s[i + 1] == "u":
                out.append(int(s[i + 2:i + 6], 16))
                i += 6
            elif s[i + 1] == "U":
                out.append(int(s[i + 2:i + 10], 16))
                i += 10
            else:
                raise SystemExit("escape " + s)
        else:
            out.append(ord(s[i]))
            i += 1
    return out


def parse_tables(text):
    tables = {}
    for m in re.finditer(r"var (\w+) = &unicode\.RangeTable\{\n(.*?)\n\}\n", text, re.S):
        name, body = m.group(1), m.group(2)
        r16, r32 = [], []
        cur = None
        latin = 0
        for line in body.split("\n"):
            line = line.strip()
            if line.startswith("R16:"):
                cur = r16
            elif line.startswith("R32:"):
                cur = r32
            elif line.startswith("LatinOffset:"):
                latin = int(line.split(":")[1].strip().rstrip(","))
            else:
                mm = re.match(r"\{0x([0-9A-Fa-f]+), 0x([0-9A-Fa-f]+), (\d+)\},", line)
                if mm:
                    cur.append((int(mm.group(1), 16), int(mm.group(2), 16), int(mm.group(3))))
        tables[name] = (r16, r32, latin)
    return tables


def upper_snake(name):
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", s)
    return s.upper()


def emit_table(out, go_name, table):
    r16, r32, latin = table
    out.append(f"pub(crate) static {upper_snake(go_name)}: RangeTable = RangeTable {{")
    out.append("    r16: &[")
    for lo, hi, stride in r16:
        out.append(f"        Range16::new(0x{lo:X}, 0x{hi:X}, {stride}),")
    out.append("    ],")
    out.append("    r32: &[")
    for lo, hi, stride in r32:
        out.append(f"        Range32::new(0x{lo:X}, 0x{hi:X}, {stride}),")
    out.append("    ],")
    out.append(f"    latin_offset: {latin},")
    out.append("};")


def main():
    out_dir = sys.argv[1]
    case_text = open(REF + "js_case_generated.go").read()
    rows = []
    for m in re.finditer(
        r'^\t0x([0-9A-F]+):\s+\{lower: "([^"]*)", upper: "([^"]*)", (?:conditionalLower: "([^"]*)", )?condition: specialCasingCondition(\w+)\},$',
        case_text,
        re.M,
    ):
        rune = int(m.group(1), 16)
        rows.append((rune, unescape(m.group(2)), unescape(m.group(3)), unescape(m.group(4) or ""), m.group(5)))
    keys = [r[0] for r in rows]
    assert keys == sorted(keys) and len(set(keys)) == len(keys), "rows are not ordered by rune"
    sequences = []

    def code(seq):
        assert 1 <= len(seq) <= 3 and 0 not in seq, seq
        if len(seq) == 1:
            return seq[0]
        if seq not in sequences:
            sequences.append(seq)
        return 0x110000 + sequences.index(seq)

    out = [
        f"// Generated from internal/stringutil/js_case_generated.go of typescript-go {COMMIT} (Unicode 15.1.0). Do not edit.",
        "use crate::stringutil::util::unicode::{Range16, Range32, RangeTable};",
        "",
        "#[derive(Clone, Copy, PartialEq, Eq)]",
        "pub(crate) enum SpecialCasingCondition {",
        "    None,",
        "    FinalSigma,",
        "}",
        "",
        "// One value of upstream's specialCasingMappings: each mapping is up to three runes, a zero ends it.",
        "#[derive(Clone, Copy)]",
        "pub(crate) struct SpecialCasingMapping {",
        "    pub(crate) lower: [u32; 3],",
        "    pub(crate) upper: [u32; 3],",
        "    pub(crate) conditional_lower: [u32; 3],",
        "    pub(crate) condition: SpecialCasingCondition,",
        "}",
        "",
        "// A mapping of more than one rune is stored as this number plus its index in SPECIAL_CASING_SEQUENCES.",
        "const SEQUENCE_BASE: u32 = 0x110000;",
        "",
        "fn special_casing_sequence(code: u32) -> [u32; 3] {",
        "    match code.checked_sub(SEQUENCE_BASE) {",
        "        Some(index) => SPECIAL_CASING_SEQUENCES.get(index as usize).copied().unwrap_or([code, 0, 0]),",
        "        None => [code, 0, 0],",
        "    }",
        "}",
        "",
        "// `specialCasingMappings[r]` of upstream: None when the rune has no entry.",
        "pub(crate) fn special_casing_mappings(r: u32) -> Option<SpecialCasingMapping> {",
        "    let index = SPECIAL_CASING_MAPPINGS.binary_search_by(|row| row[0].cmp(&r)).ok()?;",
        "    let row = SPECIAL_CASING_MAPPINGS.get(index)?;",
        "    let conditional = SPECIAL_CASING_CONDITIONAL_LOWER.iter().find(|entry| entry[0] == r);",
        "    Some(SpecialCasingMapping {",
        "        lower: special_casing_sequence(row[1]),",
        "        upper: special_casing_sequence(row[2]),",
        "        conditional_lower: match conditional {",
        "            Some(entry) => special_casing_sequence(entry[1]),",
        "            None => [0, 0, 0],",
        "        },",
        "        condition: match conditional {",
        "            Some(_) => SpecialCasingCondition::FinalSigma,",
        "            None => SpecialCasingCondition::None,",
        "        },",
        "    })",
        "}",
        "",
    ]
    table_rows = []
    conditional = []
    for rune, lower, upper, cond_lower, cond in rows:
        table_rows.append((rune, code(lower), code(upper)))
        if cond == "FinalSigma":
            conditional.append((rune, code(cond_lower)))
        else:
            assert cond == "None" and not cond_lower
    out.append("// The runes of upstream's specialCasingMappings in order, each with its lower and its upper mapping.")
    out.append(f"static SPECIAL_CASING_MAPPINGS: [[u32; 3]; {len(table_rows)}] = [")
    for rune, lo, up in table_rows:
        out.append(f"    [0x{rune:X}, 0x{lo:X}, 0x{up:X}],")
    out.append("];")
    out.append("")
    out.append("// The runes whose condition is specialCasingConditionFinalSigma, each with its conditionalLower.")
    out.append(f"static SPECIAL_CASING_CONDITIONAL_LOWER: [[u32; 2]; {len(conditional)}] = [")
    for rune, lo in conditional:
        out.append(f"    [0x{rune:X}, 0x{lo:X}],")
    out.append("];")
    out.append("")
    out.append(f"static SPECIAL_CASING_SEQUENCES: [[u32; 3]; {len(sequences)}] = [")
    for seq in sequences:
        padded = seq + [0] * (3 - len(seq))
        out.append("    [" + ", ".join(f"0x{c:X}" for c in padded) + "],")
    out.append("];")
    tables = parse_tables(case_text)
    for name in ["unicodeCasedRanges", "unicodeCaseIgnorableRanges"]:
        out.append("")
        emit_table(out, name, tables[name])
    open(out_dir + "/js_case_generated.rs", "w").write("\n".join(out) + "\n")

    id_text = open(REF + "identifier_parts_generated.go").read()
    tables = parse_tables(id_text)
    out = [
        f"// Generated from internal/stringutil/identifier_parts_generated.go of typescript-go {COMMIT} (Unicode 15.1.0). Do not edit.",
        "use crate::stringutil::util::unicode::{Range16, Range32, RangeTable};",
    ]
    for name in ["unicodeESNextIdentifierStart", "unicodeESNextIdentifierPart"]:
        out.append("")
        emit_table(out, name, tables[name])
    open(out_dir + "/identifier_parts_generated.rs", "w").write("\n".join(out) + "\n")
    print("rows", len(rows), "sequences", len(sequences), "conditional", len(conditional))

    if len(sys.argv) > 2:
        lower = {r[0]: r[1] for r in rows}
        upper = {r[0]: r[2] for r in rows}

        def simple(table, r):
            seq = table.get(r)
            return seq[0] if seq is not None and len(seq) == 1 else r

        go = {}
        for line in open(sys.argv[2]):
            parts = line.split()
            if parts[0] == "version":
                continue
            r, l, u, f = (int(p, 16) for p in parts)
            go[r] = (l, u, f)
        low_x, up_x, fold_x = [], [], []
        for r in range(0x110000):
            if 0xD800 <= r <= 0xDFFF:
                continue
            l, u, f = go.get(r, (r, r, r))
            if simple(lower, r) != l:
                low_x.append((r, l))
            if simple(upper, r) != u:
                up_x.append((r, u))
            if r < 0x80:
                continue
            expect = l if l != r else u
            if expect != f:
                fold_x.append((r, f))
        print("to_lower exceptions", len(low_x), " ".join(f"(0x{a:X}, 0x{b:X})," for a, b in low_x))
        print("to_upper exceptions", len(up_x), " ".join(f"(0x{a:X}, 0x{b:X})," for a, b in up_x))
        print("simple_fold exceptions above ASCII", len(fold_x), " ".join(f"(0x{a:X}, 0x{b:X})," for a, b in fold_x))
        ascii_fold = [go.get(r, (r, r, r))[2] for r in range(0x80)]
        odd = [(r, f) for r, f in enumerate(ascii_fold) if f != r and not (chr(r).isalpha() and abs(f - r) == 32)]
        print("ascii fold not +-32", " ".join(f"(0x{a:X}, 0x{b:X})," for a, b in odd))


main()
