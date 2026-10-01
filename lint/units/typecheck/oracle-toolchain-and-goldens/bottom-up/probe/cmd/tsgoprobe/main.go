// The one probe of the typecheck oracle: typescript-go at 89d5d5b, built through an overlay (bootstrap.sh), with one
// sub-command per artefact. Each sub-command is one of the research probes of the unit notes, unchanged, so that its
// stored goldens can be made again byte for byte (replay.sh).
// usage: tsgoprobe <sub-command> <arguments of that sub-command>
package main

import (
	"fmt"
	"os"

	"github.com/microsoft/typescript-go/internal/zzprobe/astutil"
	"github.com/microsoft/typescript-go/internal/zzprobe/bind"
	"github.com/microsoft/typescript-go/internal/zzprobe/cli"
	"github.com/microsoft/typescript-go/internal/zzprobe/decl"
	"github.com/microsoft/typescript-go/internal/zzprobe/declstrings"
	"github.com/microsoft/typescript-go/internal/zzprobe/diaggt"
	"github.com/microsoft/typescript-go/internal/zzprobe/ecf"
	"github.com/microsoft/typescript-go/internal/zzprobe/initstate"
	"github.com/microsoft/typescript-go/internal/zzprobe/k4"
	"github.com/microsoft/typescript-go/internal/zzprobe/leafchk"
	"github.com/microsoft/typescript-go/internal/zzprobe/leafdump"
	"github.com/microsoft/typescript-go/internal/zzprobe/leafdump2"
	"github.com/microsoft/typescript-go/internal/zzprobe/leafdump3"
	"github.com/microsoft/typescript-go/internal/zzprobe/pien"
	"github.com/microsoft/typescript-go/internal/zzprobe/rel"
	"github.com/microsoft/typescript-go/internal/zzprobe/roundtrip"
	"github.com/microsoft/typescript-go/internal/zzprobe/rt"
	"github.com/microsoft/typescript-go/internal/zzprobe/state"
	"github.com/microsoft/typescript-go/internal/zzprobe/suite"
	"github.com/microsoft/typescript-go/internal/zzprobe/tree"
	"github.com/microsoft/typescript-go/internal/zzprobe/typestrings"
)

var commands = []struct {
	name string
	help string
	run  func()
}{
	{"tree", "the tree of the parser, one <name>.tsgo.txt per file: [-force] [-jsx] [-nojsdoc] <outdir> <name>=<path>...", tree.Main},
	{"bind", "what the binder writes, one <name>.bind.txt per file: [-force] [-jsx] [-harness] [-symbols <dir>] <outdir|-> <name>=<path>|@<list>...", bind.Main},
	{"astutil", "the single-node utilities of ast/utilities.go on every node, one <name>.astutil.txt per file: [-bind] <outdir|-> <name>=<path>...", astutil.Main},
	{"init", "the checker right after NewChecker: [-strict|-nostrict] [-exact] [-aliases] [-max N] <name>=<path>...", initstate.Main},
	{"state", "checker-state v1, the structural dump of types, signatures, symbols and links: see zzprobe/state", state.Main},
	{"check", "diagnostics and creation counters: [-strict|-nostrict] [-checkjs] <name>=<path>...", k4.Main},
	{"checkstate", "diagnostics with chains, suggestions and the flow and stack counters: [-strict] [-unreachable-error] [-suggestions] [-maxstack N] <name>=<path>...", ecf.Main},
	{"checkopts", "diagnostics under any compiler option: [-strict] [-checkjs] [-sugg] [-o key=value]... <name>=<path>...", decl.Main},
	{"rel", "relation caches, the trace of relater.go and inference.go: [-strict] [-trace] [-funcs] [-rel relation:a:b]... <name>=<path>...", rel.Main},
	{"typestrings", "three printed forms of the type of every `declare const x: T`: [-strict] [-notrunc] <name>=<path>...", typestrings.Main},
	{"declstrings", "the printed forms of every declaration: [-strict] [-notrunc] <name>=<path>...", declstrings.Main},
	{"roundtrip", "the emit printer on texts read from standard input as type, signature or expression: [all]", roundtrip.Main},
	{"rt", "the emit printer on type texts of a file: <file> [strip|single]", rt.Main},
	{"pien", "parser.ParseIsolatedEntityName on each line of standard input", pien.Main},
	{"diag", "formatting, comparison and sorting of diagnostics on vectors read from standard input", diaggt.Main},
	{"leafdump", "vectors of jsnum and stringutil (number to string, string to number, case mapping), to standard output", leafdump.Main},
	{"leafdump2", "vectors of jsnum: number formatting of random doubles", leafdump2.Main},
	{"leafdump3", "vectors of jsnum: a third random set", leafdump3.Main},
	{"leafchk", "the special casing table of stringutil against unicode", leafchk.Main},
	{"cli", "the real command line of tsgo with the bundled libs: <tsc arguments>", cli.Main},
	{"suite", "the reference's own test suites; K5_MANIFEST_DIR records the program of every instance: [-test.run <regexp>] ...", suite.Main},
}

func main() {
	if len(os.Args) >= 2 {
		for _, c := range commands {
			if c.name == os.Args[1] {
				os.Args = append([]string{os.Args[0] + " " + c.name}, os.Args[2:]...)
				c.run()
				return
			}
		}
	}
	fmt.Fprintln(os.Stderr, "usage: tsgoprobe <sub-command> <arguments>")
	for _, c := range commands {
		fmt.Fprintf(os.Stderr, "  %-12s %s\n", c.name, c.help)
	}
	os.Exit(2)
}
