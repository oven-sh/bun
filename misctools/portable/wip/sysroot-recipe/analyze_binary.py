#!/usr/bin/env python3
"""
Static checks of a linked jsc binary for the portable ABI.

  analyze_binary.py <binary> <lld map file> <out.json>

1. program headers / dynamic section: PT_INTERP, PT_TLS, DT_NEEDED
2. every instruction in executable sections with a %fs: or %gs: segment override, attributed to the input
   object file (and function) through the linker map
3. every instruction that addresses memory BELOW the stack pointer (negative displacement from %rsp, not lea):
   that is a red zone use
"""
import bisect, collections, json, re, subprocess, sys

LLVM = "/usr/lib/llvm-current/bin/"


def sh(*cmd):
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode("utf-8", "replace")


def parse_map(path):
    """lld map: VMA LMA Size Align  Out / In / Symbol by indentation."""
    sections = []   # (start, end, object, insection)
    symbols = []    # (addr, name)
    line_re = re.compile(r"^\s*([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+(\d+) (.*)$")
    with open(path, errors="replace") as f:
        next(f)
        for line in f:
            m = line_re.match(line.rstrip("\n"))
            if not m:
                continue
            vma = int(m.group(1), 16)
            size = int(m.group(3), 16)
            rest = m.group(5)
            indent = len(rest) - len(rest.lstrip(" "))
            text = rest.strip()
            if indent >= 16:
                symbols.append((vma, text))
            elif indent >= 8:
                mm = re.match(r"^(.*):\(([^()]*)\)$", text)
                if mm and size:
                    sections.append((vma, vma + size, mm.group(1), mm.group(2)))
    sections.sort()
    symbols.sort()
    return sections, symbols


def short_object(obj):
    # "lib/libJavaScriptCore.a(UnifiedSource-abc-1.cpp.o)" -> archive, member
    m = re.match(r"^(.*?)([^/]+\.a)\((.*)\)$", obj)
    if m:
        return m.group(2), m.group(3)
    return "", obj.split("/")[-1]


def main():
    binary, mapfile, out = sys.argv[1:4]
    res = {"binary": binary}

    ph = sh(LLVM + "llvm-readelf", "-lW", binary)
    dyn = sh(LLVM + "llvm-readelf", "-dW", binary)
    hdr = sh(LLVM + "llvm-readelf", "-hW", binary)
    res["elf_type"] = re.search(r"Type:\s+(.*)", hdr).group(1).strip()
    res["has_PT_INTERP"] = bool(re.search(r"^\s*INTERP\s", ph, re.M))
    res["has_PT_TLS"] = bool(re.search(r"^\s*TLS\s", ph, re.M))
    res["has_PT_DYNAMIC"] = bool(re.search(r"^\s*DYNAMIC\s", ph, re.M))
    res["DT_NEEDED"] = re.findall(r"\(NEEDED\)\s+(.*)", dyn)
    res["dynamic_flags"] = re.findall(r"\((FLAGS_1|FLAGS)\)\s+(.*)", dyn)

    sizes = sh(LLVM + "llvm-size", "-A", binary)
    sec = {}
    for line in sizes.splitlines():
        p = line.split()
        if len(p) == 3 and p[1].isdigit():
            sec[p[0]] = int(p[1])
    res["section_sizes"] = {k: sec[k] for k in sec if k in (".text", ".rodata", ".data", ".bss", ".data.rel.ro", ".eh_frame", ".rela.dyn", ".init", ".fini", ".tdata", ".tbss", ".got", ".got.plt", ".plt", ".relr.dyn")}

    sections, symbols = parse_map(mapfile)
    starts = [s[0] for s in sections]
    sym_addrs = [s[0] for s in symbols]

    def locate(addr):
        i = bisect.bisect_right(starts, addr) - 1
        obj, insec = "?", "?"
        # sections can nest in the list (zero sized); walk back a little
        for j in range(i, max(-1, i - 50), -1):
            s = sections[j]
            if s[0] <= addr < s[1]:
                obj, insec = s[2], s[3]
                break
        k = bisect.bisect_right(sym_addrs, addr) - 1
        sym = symbols[k][1] if k >= 0 else "?"
        return obj, insec, sym

    tls_sites = []
    redzone_sites = []
    insn_re = re.compile(r"^\s*([0-9a-f]+):\s+(.*)$")
    seg_re = re.compile(r"%[fg]s:")
    # plain "-N(%rsp)" only. "-N(%rsp,%reg,scale)" is an indexed access into a stack array (buf[i-1]) whose
    # effective address is not below %rsp; those are counted apart as "indexed".
    rz_re = re.compile(r"-0x[0-9a-f]+\(%rsp\)|-[0-9]+\(%rsp\)")
    rz_indexed_re = re.compile(r"-0x[0-9a-f]+\(%rsp,|-[0-9]+\(%rsp,")
    p = subprocess.Popen([LLVM + "llvm-objdump", "-d", "--no-show-raw-insn", binary], stdout=subprocess.PIPE)
    cur_section = ""
    n_insn = 0
    n_indexed = 0
    for raw in p.stdout:
        line = raw.decode("utf-8", "replace")
        if line.startswith("Disassembly of section"):
            cur_section = line.split()[-1].rstrip(":")
            continue
        m = insn_re.match(line)
        if not m:
            continue
        n_insn += 1
        addr = int(m.group(1), 16)
        text = m.group(2).strip()
        if seg_re.search(text):
            obj, insec, sym = locate(addr)
            tls_sites.append({"addr": hex(addr), "insn": re.sub(r"\s+", " ", text), "object": obj, "in_section": insec, "symbol": sym, "out_section": cur_section})
        if rz_indexed_re.search(text) and not text.startswith("lea"):
            n_indexed += 1
        if rz_re.search(text) and not text.startswith("lea"):
            obj, insec, sym = locate(addr)
            redzone_sites.append({"addr": hex(addr), "insn": re.sub(r"\s+", " ", text), "object": obj, "in_section": insec, "symbol": sym, "out_section": cur_section})
    p.wait()
    res["instructions_disassembled"] = n_insn

    def group(sites):
        by_obj = collections.OrderedDict()
        for s in sites:
            arch, member = short_object(s["object"])
            key = (arch + ":" + member) if arch else member
            g = by_obj.setdefault(key, {"object": key, "count": 0, "forms": collections.Counter(), "functions": collections.Counter()})
            g["count"] += 1
            form = re.sub(r"%r[a-z0-9]+$|%e[a-z]+$", "%reg", s["insn"])
            g["forms"][form] += 1
            g["functions"][s["symbol"]] += 1
        outl = []
        for g in sorted(by_obj.values(), key=lambda g: -g["count"]):
            outl.append({"object": g["object"], "count": g["count"], "forms": dict(g["forms"].most_common(8)),
                         "functions": dict(g["functions"].most_common(12)), "n_functions": len(g["functions"])})
        return outl

    res["tls_instruction_total"] = len(tls_sites)
    res["tls_by_object"] = group(tls_sites)
    by_arch = collections.Counter()
    for s in tls_sites:
        arch, member = short_object(s["object"])
        by_arch[arch or member] += 1
    res["tls_by_archive"] = dict(by_arch.most_common())
    res["redzone_instruction_total"] = len(redzone_sites)
    res["negative_rsp_indexed_not_redzone"] = n_indexed
    res["redzone_by_object"] = group(redzone_sites)
    by_arch = collections.Counter()
    for s in redzone_sites:
        arch, member = short_object(s["object"])
        by_arch[arch or member] += 1
    res["redzone_by_archive"] = dict(by_arch.most_common())
    res["tls_sites_outside_libc_sample"] = [s for s in tls_sites if "libc.a" not in s["object"]][:200]
    res["redzone_sites_sample"] = redzone_sites[:100]
    with open(out, "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps({k: res[k] for k in ("elf_type", "has_PT_INTERP", "has_PT_TLS", "has_PT_DYNAMIC", "DT_NEEDED", "section_sizes",
                                          "instructions_disassembled", "tls_instruction_total", "tls_by_archive",
                                          "redzone_instruction_total", "negative_rsp_indexed_not_redzone", "redzone_by_archive")}, indent=1))


if __name__ == "__main__":
    main()
