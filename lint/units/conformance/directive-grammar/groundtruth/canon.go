package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
)

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// canonRecord is the text whose sha256 is the ground truth of one case.
func canonRecord(content string, fileName string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "decoded %d %s\n", len(content), sha(content))
	panicText := ""
	var units []*testUnit
	symlinks := map[string]string{}
	globalOptions := map[string]string{}
	currentDirectory := ""
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicText = fmt.Sprint(r)
				units = nil
			}
		}()
		units, symlinks, currentDirectory, globalOptions, _ = ParseTestFilesAndSymlinksWithOptions(content, fileName,
			func(filename string, content string, fileOptions map[string]string) (*testUnit, error) {
				return &testUnit{content: content, name: filename}, nil
			}, ParseTestFilesOptions{})
	}()
	if panicText != "" {
		symlinks = map[string]string{}
		globalOptions = map[string]string{}
		currentDirectory = ""
	}
	fmt.Fprintf(&b, "panic %s\n", panicText)
	fmt.Fprintf(&b, "currentDirectory %s\n", currentDirectory)
	settings := extractCompilerSettings(content)
	fmt.Fprintf(&b, "settings %d\n", len(settings))
	for _, k := range sortedKeys(settings) {
		fmt.Fprintf(&b, "%s=%s\n", k, settings[k])
	}
	fmt.Fprintf(&b, "globalOptions %d\n", len(globalOptions))
	for _, k := range sortedKeys(globalOptions) {
		fmt.Fprintf(&b, "%s=%s\n", k, globalOptions[k])
	}
	fmt.Fprintf(&b, "symlinks %d\n", len(symlinks))
	for _, k := range sortedKeys(symlinks) {
		fmt.Fprintf(&b, "%s\n%s\n", k, symlinks[k])
	}
	var config *testUnit
	for i, data := range units {
		if GetConfigNameFromFileName(data.name) != "" {
			config = data
			units = slices.Delete(units, i, i+1)
			break
		}
	}
	if config != nil {
		fmt.Fprintf(&b, "configUnit 1\n%s\n%d %s\n", config.name, len(config.content), sha(config.content))
	} else {
		fmt.Fprintf(&b, "configUnit 0\n")
	}
	fmt.Fprintf(&b, "units %d\n", len(units))
	for _, u := range units {
		fmt.Fprintf(&b, "%s\n%d %s\n", u.name, len(u.content), sha(u.content))
	}
	return b.String()
}

func mainCanon(root string, outPath string, show string) {
	re := regexp.MustCompile(`\.tsx?$`)
	var rels []string
	for _, suite := range []string{"conformance", "compiler"} {
		_ = filepath.WalkDir(filepath.Join(root, suite), func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() && re.MatchString(NormalizeSlashes(path)) {
				r, _ := filepath.Rel(root, path)
				rels = append(rels, NormalizeSlashes(r))
			}
			return nil
		})
	}
	sort.Strings(rels)
	f, err := os.Create(outPath)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	defer w.Flush()
	for _, rel := range rels {
		b, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			panic(err)
		}
		content := ""
		if len(b) != 0 {
			content, _ = decodeBytes(string(b))
		}
		rec := canonRecord(content, rel)
		if rel == show {
			fmt.Fprint(os.Stderr, rec)
		}
		fmt.Fprintf(w, "%s\t%s\n", rel, sha(rec))
	}
	fmt.Fprintln(os.Stderr, "cases:", len(rels))
}
