// Research probe: runs the reference's own compiler suites from this program and records the program of every instance.
// The harness writes its local baselines below the repository root, so the run uses a scratch root made of links to the
// reference (ORACLE_REPO_ROOT, read by the patched copy of internal/repo/paths.go) and never writes into the clone.
// usage: manifest [-local] [-run <go test pattern>] [-mode diag|diagdecl] [-scratch <dir>] [-v] <out dir>
//
//	<out dir>/manifest.jsonl   one line per run instance (zz_k5.go), in the order in which the instances finish
//	-mode diag      one check per instance, no emit, only the error baseline is compared (CTP_MODE of the harness patch)
//	the exit status and the test log on stdout are those of `go test`
package manifest

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"testing"

	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/repo"
	"github.com/microsoft/typescript-go/internal/testrunner"
)

func fail(err error) {
	fmt.Fprintln(os.Stderr, "manifest:", err)
	os.Exit(2)
}

func link(from string, to string) {
	if _, err := os.Lstat(to); err == nil {
		return
	}
	if err := os.Symlink(from, to); err != nil {
		fail(err)
	}
}

func Main() {
	args := os.Args[1:]
	local := false
	verbose := false
	run := ""
	mode := ""
	scratch := ""
	for len(args) > 0 && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-local":
			local = true
		case "-v":
			verbose = true
		case "-run":
			run = args[1]
			args = args[1:]
		case "-mode":
			mode = args[1]
			args = args[1:]
		case "-scratch":
			scratch = args[1]
			args = args[1:]
		}
		args = args[1:]
	}
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: manifest [-local] [-run <go test pattern>] [-mode diag|diagdecl] [-scratch <dir>] [-v] <out dir>")
		os.Exit(2)
	}
	out, err := filepath.Abs(args[0])
	if err != nil {
		fail(err)
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		fail(err)
	}
	if os.Getenv("ORACLE_REPO_ROOT") == "" {
		// The root is read once, when the packages of the harness initialise: start again with the scratch root set.
		ref := repo.RootPath()
		if scratch == "" {
			scratch = filepath.Join(out, "root")
		}
		scratch, err = filepath.Abs(scratch)
		if err != nil {
			fail(err)
		}
		if err := os.MkdirAll(filepath.Join(scratch, "testdata", "baselines", "local"), 0o755); err != nil {
			fail(err)
		}
		link(filepath.Join(ref, "_submodules"), filepath.Join(scratch, "_submodules"))
		link(filepath.Join(ref, "testdata", "baselines", "reference"), filepath.Join(scratch, "testdata", "baselines", "reference"))
		for _, x := range []string{"fixtures", "tests", "submoduleAccepted.txt", "submoduleTriaged.txt"} {
			link(filepath.Join(ref, "testdata", x), filepath.Join(scratch, "testdata", x))
		}
		exe, err := os.Executable()
		if err != nil {
			fail(err)
		}
		argv := append([]string{exe, "manifest"}, os.Args[1:]...)
		fail(syscall.Exec(exe, argv, append(os.Environ(), "ORACLE_REPO_ROOT="+scratch)))
	}
	if err := os.Setenv("K5_MANIFEST_DIR", out); err != nil {
		fail(err)
	}
	if mode != "" {
		if err := os.Setenv("CTP_MODE", mode); err != nil {
			fail(err)
		}
	}
	name := "TestSubmodule"
	if local {
		name = "TestLocal"
	}
	if run == "" {
		run = "^" + name + "$"
	}
	core.ApplyDebugStackLimit()
	os.Args = []string{os.Args[0], "-test.run=" + run, "-test.count=1", "-test.timeout=170m"}
	if verbose {
		os.Args = append(os.Args, "-test.v")
	}
	match := func(pat string, str string) (bool, error) { return regexp.MatchString(pat, str) }
	tests := []testing.InternalTest{{Name: name, F: func(t *testing.T) { testrunner.OracleRunCompilerTests(t, !local) }}}
	testing.Main(match, tests, nil, nil)
}
