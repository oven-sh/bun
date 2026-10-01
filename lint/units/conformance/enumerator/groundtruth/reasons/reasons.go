// Ground truth for the text of each skip: the rule and the stringers of the reference, standard library only.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// The eight fields that the rule reads, with the types of core.CompilerOptions.
type CompilerOptions struct {
	Module                       ModuleKind
	ModuleResolution             ModuleResolutionKind
	ESModuleInterop              Tristate
	AllowSyntheticDefaultImports Tristate
	BaseUrl                      string
	OutFile                      string
	Target                       ScriptTarget
	AlwaysStrict                 Tristate
}

// Stands for *testing.T: Skipf ends the function the way runtime.Goexit does, by unwinding.
type recorder struct{ text string }

type skipped struct{}

func (r *recorder) Helper() {}

func (r *recorder) Skipf(format string, args ...any) {
	r.text = fmt.Sprintf(format, args...)
	panic(skipped{})
}

// ---- internal/core/tristate.go (verbatim subset) ----
type Tristate byte

const (
	TSUnknown Tristate = iota
	TSFalse
	TSTrue
)

func (t Tristate) IsTrue() bool {
	return t == TSTrue
}

func (t Tristate) IsTrueOrUnknown() bool {
	return t == TSTrue || t == TSUnknown
}

func (t Tristate) IsFalse() bool {
	return t == TSFalse
}

// ---- internal/core/compileroptions.go:384-409 (verbatim) ----
type ModuleKind int32

const (
	ModuleKindNone     ModuleKind = 0
	ModuleKindCommonJS ModuleKind = 1
	// Deprecated: Do not use outside of options parsing and validation.
	ModuleKindAMD ModuleKind = 2
	// Deprecated: Do not use outside of options parsing and validation.
	ModuleKindUMD ModuleKind = 3
	// Deprecated: Do not use outside of options parsing and validation.
	ModuleKindSystem ModuleKind = 4
	// NOTE: ES module kinds should be contiguous to more easily check whether a module kind is *any* ES module kind.
	//       Non-ES module kinds should not come between ES2015 (the earliest ES module kind) and ESNext (the last ES
	//       module kind).
	ModuleKindES2015 ModuleKind = 5
	ModuleKindES2020 ModuleKind = 6
	ModuleKindES2022 ModuleKind = 7
	ModuleKindESNext ModuleKind = 99
	// Node16+ is an amalgam of commonjs (albeit updated) and es2022+, and represents a distinct module system from es2020/esnext
	ModuleKindNode16   ModuleKind = 100
	ModuleKindNode18   ModuleKind = 101
	ModuleKindNode20   ModuleKind = 102
	ModuleKindNodeNext ModuleKind = 199
	// Emit as written
	ModuleKindPreserve ModuleKind = 200
)

// ---- internal/core/compileroptions.go:429-445 (verbatim) ----
type ModuleResolutionKind int32

const (
	ModuleResolutionKindUnknown ModuleResolutionKind = 0
	// Deprecated: Do not use outside of options parsing and validation.
	ModuleResolutionKindClassic ModuleResolutionKind = 1
	// Deprecated: Do not use outside of options parsing and validation.
	ModuleResolutionKindNode10 ModuleResolutionKind = 2
	// Starting with node16, node's module resolver has significant departures from traditional cjs resolution
	// to better support ECMAScript modules and their use within node - however more features are still being added.
	// TypeScript's Node ESM support was introduced after Node 12 went end-of-life, and Node 14 is the earliest stable
	// version that supports both pattern trailers - *but*, Node 16 is the first version that also supports ECMAScript 2022.
	// In turn, we offer both a `NodeNext` moving resolution target, and a `Node16` version-anchored resolution target
	ModuleResolutionKindNode16   ModuleResolutionKind = 3
	ModuleResolutionKindNodeNext ModuleResolutionKind = 99 // Not simply `Node16` so that compiled code linked against TS can use the `Next` value reliably (same as with `ModuleKind`)
	ModuleResolutionKindBundler  ModuleResolutionKind = 100
)

// ---- internal/core/compileroptions.go:506-527 (verbatim) ----
type ScriptTarget int32

const (
	ScriptTargetNone ScriptTarget = 0
	// Deprecated: Do not use outside of options parsing and validation.
	ScriptTargetES5            ScriptTarget = 1
	ScriptTargetES2015         ScriptTarget = 2
	ScriptTargetES2016         ScriptTarget = 3
	ScriptTargetES2017         ScriptTarget = 4
	ScriptTargetES2018         ScriptTarget = 5
	ScriptTargetES2019         ScriptTarget = 6
	ScriptTargetES2020         ScriptTarget = 7
	ScriptTargetES2021         ScriptTarget = 8
	ScriptTargetES2022         ScriptTarget = 9
	ScriptTargetES2023         ScriptTarget = 10
	ScriptTargetES2024         ScriptTarget = 11
	ScriptTargetES2025         ScriptTarget = 12
	ScriptTargetESNext         ScriptTarget = 99
	ScriptTargetJSON           ScriptTarget = 100
	ScriptTargetLatest         ScriptTarget = ScriptTargetESNext
	ScriptTargetLatestStandard ScriptTarget = ScriptTargetES2025
)

// ---- internal/core/modulekind_stringer_generated.go (verbatim) ----
func _() {
	// An "invalid array index" compiler error signifies that the constant values have changed.
	// Re-run the stringer command to generate them again.
	var x [1]struct{}
	_ = x[ModuleKindNone-0]
	_ = x[ModuleKindCommonJS-1]
	_ = x[ModuleKindAMD-2]
	_ = x[ModuleKindUMD-3]
	_ = x[ModuleKindSystem-4]
	_ = x[ModuleKindES2015-5]
	_ = x[ModuleKindES2020-6]
	_ = x[ModuleKindES2022-7]
	_ = x[ModuleKindESNext-99]
	_ = x[ModuleKindNode16-100]
	_ = x[ModuleKindNode18-101]
	_ = x[ModuleKindNode20-102]
	_ = x[ModuleKindNodeNext-199]
	_ = x[ModuleKindPreserve-200]
}

const (
	_ModuleKind_name_0 = "NoneCommonJSAMDUMDSystemES2015ES2020ES2022"
	_ModuleKind_name_1 = "ESNextNode16Node18Node20"
	_ModuleKind_name_2 = "NodeNextPreserve"
)

var (
	_ModuleKind_index_0 = [...]uint8{0, 4, 12, 15, 18, 24, 30, 36, 42}
	_ModuleKind_index_1 = [...]uint8{0, 6, 12, 18, 24}
	_ModuleKind_index_2 = [...]uint8{0, 8, 16}
)

func (i ModuleKind) String() string {
	switch {
	case 0 <= i && i <= 7:
		return _ModuleKind_name_0[_ModuleKind_index_0[i]:_ModuleKind_index_0[i+1]]
	case 99 <= i && i <= 102:
		i -= 99
		return _ModuleKind_name_1[_ModuleKind_index_1[i]:_ModuleKind_index_1[i+1]]
	case 199 <= i && i <= 200:
		i -= 199
		return _ModuleKind_name_2[_ModuleKind_index_2[i]:_ModuleKind_index_2[i+1]]
	default:
		return "ModuleKind(" + strconv.FormatInt(int64(i), 10) + ")"
	}
}

// ---- internal/core/scripttarget_stringer_generated.go (verbatim) ----
func _() {
	// An "invalid array index" compiler error signifies that the constant values have changed.
	// Re-run the stringer command to generate them again.
	var x [1]struct{}
	_ = x[ScriptTargetNone-0]
	_ = x[ScriptTargetES5-1]
	_ = x[ScriptTargetES2015-2]
	_ = x[ScriptTargetES2016-3]
	_ = x[ScriptTargetES2017-4]
	_ = x[ScriptTargetES2018-5]
	_ = x[ScriptTargetES2019-6]
	_ = x[ScriptTargetES2020-7]
	_ = x[ScriptTargetES2021-8]
	_ = x[ScriptTargetES2022-9]
	_ = x[ScriptTargetES2023-10]
	_ = x[ScriptTargetES2024-11]
	_ = x[ScriptTargetES2025-12]
	_ = x[ScriptTargetESNext-99]
	_ = x[ScriptTargetJSON-100]
	_ = x[ScriptTargetLatest-99]
	_ = x[ScriptTargetLatestStandard-12]
}

const (
	_ScriptTarget_name_0 = "NoneES5ES2015ES2016ES2017ES2018ES2019ES2020ES2021ES2022ES2023ES2024ES2025"
	_ScriptTarget_name_1 = "ESNextJSON"
)

var (
	_ScriptTarget_index_0 = [...]uint8{0, 4, 7, 13, 19, 25, 31, 37, 43, 49, 55, 61, 67, 73}
	_ScriptTarget_index_1 = [...]uint8{0, 6, 10}
)

func (i ScriptTarget) String() string {
	switch {
	case 0 <= i && i <= 12:
		return _ScriptTarget_name_0[_ScriptTarget_index_0[i]:_ScriptTarget_index_0[i+1]]
	case 99 <= i && i <= 100:
		i -= 99
		return _ScriptTarget_name_1[_ScriptTarget_index_1[i]:_ScriptTarget_index_1[i+1]]
	default:
		return "ScriptTarget(" + strconv.FormatInt(int64(i), 10) + ")"
	}
}

// ---- internal/testutil/harnessutil/harnessutil.go:1236-1265 (verbatim, t is the recorder) ----
func SkipUnsupportedCompilerOptions(t *recorder, options *CompilerOptions) {
	t.Helper()
	switch options.Module {
	case ModuleKindAMD, ModuleKindUMD, ModuleKindSystem:
		t.Skipf("unsupported module kind %s", options.Module)
	}
	switch options.ModuleResolution {
	case ModuleResolutionKindNode10, ModuleResolutionKindClassic:
		t.Skipf("unsupported module resolution kind %d", options.ModuleResolution)
	}
	if options.ESModuleInterop.IsFalse() {
		t.Skipf("esModuleInterop=false is unsupported")
	}
	if options.AllowSyntheticDefaultImports.IsFalse() {
		t.Skipf("allowSyntheticDefaultImports=false is unsupported")
	}
	if options.BaseUrl != "" {
		t.Skipf("unsupported baseUrl %s", options.BaseUrl)
	}
	if options.OutFile != "" {
		t.Skipf("unsupported outFile %s", options.OutFile)
	}
	switch options.Target {
	case ScriptTargetES5:
		t.Skipf("unsupported target %s", options.Target)
	}
	if options.AlwaysStrict.IsFalse() {
		t.Skipf("alwaysStrict=false is unsupported")
	}
}

func run(o *CompilerOptions) (text string, didSkip bool) {
	r := &recorder{}
	defer func() {
		if e := recover(); e != nil {
			if _, ok := e.(skipped); !ok {
				panic(e)
			}
			text, didSkip = r.text, true
		}
	}()
	SkipUnsupportedCompilerOptions(r, o)
	return "", false
}

// input: module moduleResolution esModuleInterop allowSyntheticDefaultImports target alwaysStrict baseUrl outFile, tab separated
func main() {
	in, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer in.Close()
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	sc := bufio.NewScanner(in)
	for sc.Scan() {
		f := strings.Split(sc.Text(), "\t")
		n := func(i int) int64 { v, _ := strconv.ParseInt(f[i], 10, 32); return v }
		o := &CompilerOptions{
			Module: ModuleKind(n(0)), ModuleResolution: ModuleResolutionKind(n(1)), ESModuleInterop: Tristate(n(2)),
			AllowSyntheticDefaultImports: Tristate(n(3)), Target: ScriptTarget(n(4)), AlwaysStrict: Tristate(n(5)),
			BaseUrl: f[6], OutFile: f[7],
		}
		text, did := run(o)
		fmt.Fprintf(w, "%s\t%v\t%s\n", sc.Text(), did, text)
	}
}
