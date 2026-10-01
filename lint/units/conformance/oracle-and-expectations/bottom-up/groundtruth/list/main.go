// Ground truth for the list reader: readFileNameSet of internal/testutil/baseline/baseline.go, the set replaced by a map.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

// ---- baseline.go:108-124 (verbatim but for the set type) ----
func readFileNameSet(path string) map[string]struct{} {
	set := map[string]struct{}{}

	if content, err := os.ReadFile(path); err == nil {
		for line := range strings.SplitSeq(string(content), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || line[0] == '#' {
				continue
			}
			set[line] = struct{}{}
		}
	} else {
		panic(fmt.Sprintf("failed to read file %s: %v", path, err))
	}

	return set
}

func main() {
	out := map[string][]string{}
	for _, p := range os.Args[1:] {
		s := readFileNameSet(p)
		keys := make([]string, 0, len(s))
		for k := range s {
			// bytes as latin1 code points, so that invalid UTF-8 survives the JSON
			var b strings.Builder
			for i := 0; i < len(k); i++ {
				b.WriteRune(rune(k[i]))
			}
			keys = append(keys, b.String())
		}
		sort.Strings(keys)
		out[p] = keys
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(out)
}
