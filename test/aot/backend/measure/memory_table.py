#!/usr/bin/env python3
"""Prints the rows of memory.py as Markdown. MB = kB / 1024.

    python3 memory_table.py rows.jsonl
"""
import json, sys

rows = {}
for text in open(sys.argv[1]):
    line = json.loads(text)
    rows[line["column"]] = line
NAMES = {"aot": "--aot", "jit": "same Bun, JIT", "released": "released Bun", "go": "Go", "rust": "Rust"}
columns = [column for column in NAMES if column in rows]
collected = [column for column in ("aot.gc", "jit.gc", "released.gc") if "report" in rows.get(column, {})]
READINGS = (("ready", "idle, 2 s after the first response"), ("load_median", "under the mix, median"), ("load_highest", "under the mix, highest"), ("after10", "10 s after the load"), ("after40", "40 s after the load"))


def anonymous(totals):
    return totals.get("Anonymous", 0) - totals.get("LazyFree", 0)


METRICS = (
    ("RSS", lambda totals: totals["Rss"]),
    ("anonymous (RssAnon)", lambda totals: totals["RssAnon"]),
    ("file-backed (RssFile + RssShmem)", lambda totals: totals["RssFile"] + totals.get("RssShmem", 0)),
    ("Private_Dirty", lambda totals: totals["Private_Dirty"]),
    ("PSS", lambda totals: totals["Pss"]),
)


def from_kb(kb):
    return "%.1f" % (kb / 1024)


def from_bytes(count):
    return "%.1f" % (count / 1048576)


def print_table(title, header, lines):
    print("**%s**\n\n| %s |\n|---|%s" % (title, " | ".join(header), "---:|" * (len(header) - 1)))
    for line in lines:
        print("| " + " | ".join(line) + " |")
    print()


lines = []
for reading, title in READINGS:
    for name, metric in METRICS:
        values = {column: metric(rows[column][reading]) for column in columns}
        against = ["%+.1f (%+.0f%%)" % ((values["aot"] - values[column]) / 1024, (values["aot"] / values[column] - 1) * 100) if "aot" in values and values.get(column) else "" for column in ("jit", "released")]
        lines.append(["%s: %s" % (title, name)] + [from_kb(values[column]) for column in columns] + against)
print_table("Resident memory of the server process, MB", ["when: what"] + [NAMES[column] for column in columns] + ["--aot against the same Bun as a JIT", "against the released Bun"], lines)

for reading, title in (("ready_mappings", "idle"), ("load_mappings", "at the end of the load"), ("after40_mappings", "40 s after the load")):
    kinds = sorted({kind for column in columns for kind in rows[column][reading]}, key=lambda kind: -max(rows[column][reading].get(kind, [0])[0] for column in columns))
    print_table("By kind of mapping, %s: resident MB (of it anonymous)" % title, ["mapping"] + [NAMES[column] for column in columns], [
        [kind] + ["%s (%s)" % (from_kb(rows[column][reading][kind][0]), from_kb(rows[column][reading][kind][2])) if kind in rows[column][reading] else "" for column in columns]
        for kind in kinds if max(rows[column][reading].get(kind, [0])[0] for column in columns) >= 100
    ])


def cells(stats, name):
    return stats[name] - stats["extraMemorySize"]


if collected:
    header = [""] + [NAMES[column.split(".")[0]] for column in collected]
    for report, title, before, after in (("report_load", "Two forced full collections with the load still on (256 requests in flight), MB", "load_median", "load_gc"), ("report", "The same 40 s after the load, MB", "after40", "gc")):
        print_table(title, header, [[name] + [value(rows[column]) for column in collected] for name, value in (
            ("capacity of the heap's blocks before", lambda row: from_bytes(cells(row[report]["before"], "heapCapacity"))),
            ("cells and their extra memory in use before (alive, and garbage since the last collection)", lambda row: from_bytes(row[report]["before"]["heapSize"])),
            ("alive after: cells", lambda row: from_bytes(cells(row[report]["after"], "heapSize"))),
            ("alive after: extra memory that cells report (strings, buffers, storage out of line)", lambda row: from_bytes(row[report]["after"]["extraMemorySize"])),
            ("number of cells before / after", lambda row: "{:,} / {:,}".format(row[report]["before"]["objectCount"], row[report]["after"]["objectCount"])),
            ("anonymous memory (RssAnon) before / after", lambda row: "%s / %s" % (from_kb(row[before]["RssAnon"]), from_kb(row[after]["RssAnon"]))),
        )])
    counts = {column: rows[column]["report"]["after"]["objectTypeCounts"] for column in collected}
    classes = sorted({name for column in collected for name in counts[column]}, key=lambda name: -max(counts[column].get(name, 0) for column in collected))[:22]
    print_table("Cells alive after the collections at rest, by class", ["class"] + header[1:], [[name] + ["{:,}".format(counts[column].get(name, 0)) for column in collected] for name in classes])
if rows.get("go", {}).get("gctrace"):
    print("Go, the last collection under load (GODEBUG=gctrace=1): `%s`" % rows["go"]["gctrace"][-1].strip()[:200])
