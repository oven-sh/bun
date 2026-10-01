// Research probe: one program for every ground-truth output of typescript-go that the port is compared with.
// It is built by ../bootstrap.sh through a build overlay on the unchanged reference clone (89d5d5b).
// usage: oracle <sub-command> [arguments of the sub-command]      `oracle help` lists them
package main

import (
	"fmt"
	"os"
	"sort"

	"github.com/microsoft/typescript-go/cmd/oracle/bind"
	"github.com/microsoft/typescript-go/cmd/oracle/canon"
	"github.com/microsoft/typescript-go/cmd/oracle/check"
	"github.com/microsoft/typescript-go/cmd/oracle/decl"
	"github.com/microsoft/typescript-go/cmd/oracle/diagfmt"
	"github.com/microsoft/typescript-go/cmd/oracle/initp"
	"github.com/microsoft/typescript-go/cmd/oracle/k4"
	"github.com/microsoft/typescript-go/cmd/oracle/leafchk"
	"github.com/microsoft/typescript-go/cmd/oracle/leafdump"
	"github.com/microsoft/typescript-go/cmd/oracle/leafdump2"
	"github.com/microsoft/typescript-go/cmd/oracle/leafdump3"
	"github.com/microsoft/typescript-go/cmd/oracle/manifest"
	"github.com/microsoft/typescript-go/cmd/oracle/pien"
	"github.com/microsoft/typescript-go/cmd/oracle/printclone"
	"github.com/microsoft/typescript-go/cmd/oracle/printdecls"
	"github.com/microsoft/typescript-go/cmd/oracle/printrt"
	"github.com/microsoft/typescript-go/cmd/oracle/printtypes"
	"github.com/microsoft/typescript-go/cmd/oracle/rel"
	"github.com/microsoft/typescript-go/cmd/oracle/tree"
	"github.com/microsoft/typescript-go/cmd/oracle/tsc"
	"github.com/microsoft/typescript-go/cmd/oracle/types"
	"github.com/microsoft/typescript-go/internal/checker"
)

type command struct {
	run  func()
	help string
}

var commands = map[string]command{
	"tree":        {tree.Main, "[-force] [-jsx] [-nojsdoc] <outdir> <name>=<path>...   tree of the parser, one <name>.tsgo.txt per file"},
	"bind":        {bind.Main, "[-force] [-jsx] [-symbols <dir>] <outdir> <name>=<path>...   what the binder wrote, one <name>.bind.txt per file"},
	"init":        {func() { checker.ProbeRecord = true; initp.Main() }, "[-strict|-nostrict] [-exact] [-max N] [-aliases] <name>=<path>...   checker state after NewChecker"},
	"types":       {func() { checker.ProbeRecord = true; types.Main() }, "[-strict|-nostrict] [-exact] [-checkjs] [-o key=value]... [-stage s]... [-from N] [-nolinks] [-schema] <name>=<path>...   every type, signature and created symbol in creation order, and the link stores; pipe it through canon"},
	"k4":          {k4.Main, "[-strict|-nostrict] [-checkjs] <name>=<path>...   diagnostics, resolution stack, counters"},
	"rel":         {rel.Main, "[-strict|-nostrict] [-exact] [-trace] [-funcs] [-rel relation:source:target]... <name>=<path>...   diagnostics and relation caches; the trace needs the trace build"},
	"rel-all":     {func() { checker.RelTraceAll = true; rel.Main() }, "same as rel, with the entry of every checker function in the trace (trace build)"},
	"canon":       {canon.Main, "(stdin: a types dump)   the dump with numbers that do not depend on the creation order of a run"},
	"check":       {check.Main, "[-strict|-nostrict] [-unreachable-error] [-suggestions] [-maxstack N] <name>=<path>...   diagnostics with chains and related information, state counters"},
	"decl":        {decl.Main, "[-strict] [-checkjs] [-sugg] [-o key=value]... <name>=<path>...   parse counts, diagnostics and suggestions with chosen options"},
	"pien":        {pien.Main, "(stdin)   parser.ParseIsolatedEntityName of each line"},
	"print-rt":    {printrt.Main, "[all] (stdin)   emit printer round trip of a text read as type, member or expression"},
	"print-types": {printtypes.Main, "[-strict|-nostrict] [-notrunc] <name>=<path>...   type printer on the annotations of `declare const`"},
	"print-decls": {printdecls.Main, "[-strict|-nostrict] [-notrunc] <name>=<path>...   symbol, type, signature and predicate printers on declarations"},
	"print-clone": {printclone.Main, "<file with one type per line> [strip|single]   printer on a deep clone of a parsed type node"},
	"diagfmt":     {diagfmt.Main, "(stdin: vectors)   diagnostic formatting, comparison and chains"},
	"leaf-dump":   {leafdump.Main, "   vectors of jsnum and stringutil"},
	"leaf-dump2":  {leafdump2.Main, "   3,000,000 number to string vectors"},
	"leaf-dump3":  {leafdump3.Main, "   20,000 exponentiation vectors"},
	"leaf-chk":    {leafchk.Main, "   the special casing table against Go's unicode package"},
	"tsc":         {tsc.Main, "<tsc arguments>   the real command line path with the bundled libs"},
	"manifest":    {manifest.Main, "[-local] [-run <regexp>] [-mode diag|diagdecl] [-scratch <dir>] <out dir>   runs the reference's own suite and records the program of every instance"},
}

func usage() {
	names := make([]string, 0, len(commands))
	for n := range commands {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		fmt.Fprintf(os.Stderr, "oracle %s %s\n", n, commands[n].help)
	}
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	sub := os.Args[1]
	c, ok := commands[sub]
	if !ok {
		usage()
		if sub == "help" {
			return
		}
		os.Exit(2)
	}
	os.Args = append([]string{os.Args[0] + " " + sub}, os.Args[2:]...)
	c.run()
}
