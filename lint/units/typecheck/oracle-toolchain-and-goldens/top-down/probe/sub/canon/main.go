// Research probe: renumbers a types dump so that two runs that differ only in creation order give the same text.
// The reference creates instantiated member symbols and some type parameters in the iteration order of Go maps, so the
// creation numbers of the `types` sub-command change from run to run (the lists and the structure do not). This
// filter works on the text alone, so the same filter can be applied to the dump of a port.
// usage: canon < raw dump > canonical dump
//
// The numbering, in this order (a record is a T, G or Y line; a mention is a reference outside a `#n[...]` set):
//  1. the records that NewChecker made before it merges the files keep their numbers (the counts of the first `mark`
//     line); what it makes later already depends on the order of a map (the merged copies of the global symbols);
//  2. the stage lines and the F lines, top to bottom: each record mentioned for the first time gets the next number
//     of its kind;
//  3. drain: the numbered records that were not scanned yet are scanned in number order, all T, then all G, then all
//     Y, again until nothing is left; scanning a Y record also scans the L lines whose key is that Y, in file order;
//  4. the L lines whose key is not a Y, each store in file order and inside a store in the order of their key text;
//     then drain;
//  5. every record that is still without a number, in the order of its line with the references replaced (a numbered
//     one by its new number, the others by `?`), T before G before Y: it gets the next number, then drain.
//
// The output has the records in the new order, the members of every `#n[...]` set in ascending number, and the L lines
// of each store sorted as text.
package canon

import (
	"bufio"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

type token struct {
	text string
	kind byte // 'T', 'G', 'Y' for a reference, 0 for text
	id   int
	set  bool // inside a #n[...] set
}

type record struct {
	kind  byte
	old   int
	toks  []token
	links []int
	done  bool
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

func isWord(b byte) bool {
	return b == '_' || isDigit(b) || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// tokens splits a line into references and the text between them. Quoted strings are text.
func tokens(line string) []token {
	var out []token
	start := 0
	inSet := false
	flush := func(end int) {
		if end > start {
			out = append(out, token{text: line[start:end]})
		}
	}
	for i := 0; i < len(line); {
		c := line[i]
		if c == '"' {
			i++
			for i < len(line) && line[i] != '"' {
				if line[i] == '\\' {
					i++
				}
				i++
			}
			i++
			continue
		}
		if c == '#' && i+1 < len(line) && isDigit(line[i+1]) {
			j := i + 1
			for j < len(line) && isDigit(line[j]) {
				j++
			}
			if j < len(line) && line[j] == '[' {
				inSet = true
				i = j + 1
				continue
			}
		}
		if c == ']' && inSet {
			inSet = false
			i++
			continue
		}
		if (c == 'T' || c == 'G' || c == 'Y') && i+1 < len(line) && isDigit(line[i+1]) && (i == 0 || strings.IndexByte(" =[{,:(", line[i-1]) >= 0) {
			j := i + 1
			for j < len(line) && isDigit(line[j]) {
				j++
			}
			if j == len(line) || !isWord(line[j]) {
				flush(i)
				n, _ := strconv.Atoi(line[i+1 : j])
				out = append(out, token{kind: c, id: n, set: inSet})
				start = j
				i = j
				continue
			}
		}
		i++
	}
	flush(len(line))
	return out
}

type state struct {
	recs  map[byte]map[int]*record
	fresh map[byte]map[int]int
	order map[byte][]*record
	next  map[byte]int
	lines []string
	ltoks [][]token
}

func (s *state) assign(kind byte, old int) {
	if _, ok := s.fresh[kind][old]; ok {
		return
	}
	s.next[kind]++
	s.fresh[kind][old] = s.next[kind]
	if r := s.recs[kind][old]; r != nil {
		s.order[kind] = append(s.order[kind], r)
	}
}

func (s *state) mention(toks []token) {
	for _, t := range toks {
		if t.kind != 0 && !t.set {
			s.assign(t.kind, t.id)
		}
	}
}

func (s *state) drain() {
	for progressed := true; progressed; {
		progressed = false
		for _, kind := range []byte{'T', 'G', 'Y'} {
			for i := 0; i < len(s.order[kind]); i++ {
				r := s.order[kind][i]
				if r.done {
					continue
				}
				r.done = true
				progressed = true
				s.mention(r.toks[1:])
				for _, l := range r.links {
					s.mention(s.ltoks[l][1:])
				}
			}
		}
	}
}

// render prints tokens with the new numbers. Set members are sorted; an unnumbered reference prints as ?.
func (s *state) render(toks []token) string {
	var sb strings.Builder
	for i := 0; i < len(toks); i++ {
		t := toks[i]
		if t.kind == 0 {
			sb.WriteString(t.text)
			continue
		}
		if !t.set {
			sb.WriteString(s.ref(t))
			continue
		}
		// A run of set members: references separated by a comma.
		var members []token
		j := i
		for j < len(toks) {
			if toks[j].kind != 0 && toks[j].set {
				members = append(members, toks[j])
				j++
				continue
			}
			if toks[j].kind == 0 && toks[j].text == "," && j+1 < len(toks) && toks[j+1].kind != 0 && toks[j+1].set {
				j++
				continue
			}
			break
		}
		sort.SliceStable(members, func(a, b int) bool {
			na, oka := s.fresh[members[a].kind][members[a].id]
			nb, okb := s.fresh[members[b].kind][members[b].id]
			if oka != okb {
				return oka
			}
			return oka && na < nb
		})
		for k, m := range members {
			if k > 0 {
				sb.WriteByte(',')
			}
			sb.WriteString(s.ref(m))
		}
		i = j - 1
	}
	return sb.String()
}

func (s *state) ref(t token) string {
	if n, ok := s.fresh[t.kind][t.id]; ok {
		return string(t.kind) + strconv.Itoa(n)
	}
	return string(t.kind) + "?"
}

func Main() {
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	w := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer w.Flush()
	s := &state{recs: map[byte]map[int]*record{}, fresh: map[byte]map[int]int{}, order: map[byte][]*record{}, next: map[byte]int{}}
	for _, k := range []byte{'T', 'G', 'Y'} {
		s.recs[k] = map[int]*record{}
		s.fresh[k] = map[int]int{}
	}
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 1<<30)
	for sc.Scan() {
		s.lines = append(s.lines, sc.Text())
	}
	section := "head"
	var head, diags []int
	var linkLines []int
	var all []*record
	s.ltoks = make([][]token, len(s.lines))
	for i, line := range s.lines {
		switch line {
		case "== types", "== signatures", "== symbols", "== links", "== diagnostics":
			section = line[3:]
			continue
		}
		switch section {
		case "head":
			head = append(head, i)
			if !strings.HasPrefix(line, "check ") && !strings.HasPrefix(line, "mark ") {
				s.ltoks[i] = tokens(line)
			}
		case "types", "signatures", "symbols":
			toks := tokens(line)
			if len(toks) == 0 || toks[0].kind == 0 {
				fmt.Fprintf(os.Stderr, "canon: line %d is not a record\n", i+1)
				os.Exit(1)
			}
			r := &record{kind: toks[0].kind, old: toks[0].id, toks: toks}
			s.recs[r.kind][r.old] = r
			all = append(all, r)
		case "links":
			// "L <store> <key> <fields>": the key is the first reference when it directly follows the store name.
			s.ltoks[i] = tokens(line)
			linkLines = append(linkLines, i)
		case "diagnostics":
			diags = append(diags, i)
		}
	}
	// 1. What the straight-line part of NewChecker made keeps its numbers: the counts of the first mark.
	for _, i := range head {
		line := s.lines[i]
		if strings.HasPrefix(line, "mark ") {
			for _, f := range strings.Fields(line) {
				kv := strings.SplitN(f, "=", 2)
				kind, ok := map[string]byte{"TypeCount": 'T', "SymbolCount": 'Y', "SignatureCount": 'G'}[kv[0]]
				if !ok || len(kv) != 2 {
					continue
				}
				n, _ := strconv.Atoi(kv[1])
				for id := 1; id <= n; id++ {
					s.assign(kind, id)
				}
			}
			break
		}
	}
	// The L lines of a created symbol belong to its record.
	storeOf := func(i int) string { return strings.Fields(s.lines[i])[1] }
	var stable []int
	for _, i := range linkLines {
		toks := s.ltoks[i]
		if len(toks) >= 2 && toks[1].kind == 'Y' && toks[0].text == "L "+storeOf(i)+" " {
			if r := s.recs['Y'][toks[1].id]; r != nil {
				r.links = append(r.links, i)
				s.ltoks[i] = append([]token{toks[0]}, toks[1:]...)
				continue
			}
		}
		stable = append(stable, i)
	}
	// 2. and 3.
	for _, i := range head {
		if s.ltoks[i] != nil {
			s.mention(s.ltoks[i])
		}
	}
	s.drain()
	// 4. The stores keep their file order; inside a store the lines go by key text.
	rank := map[string]int{}
	for _, i := range linkLines {
		if _, ok := rank[storeOf(i)]; !ok {
			rank[storeOf(i)] = len(rank)
		}
	}
	sort.SliceStable(stable, func(a, b int) bool {
		ra, rb := rank[storeOf(stable[a])], rank[storeOf(stable[b])]
		if ra != rb {
			return ra < rb
		}
		return s.lines[stable[a]] < s.lines[stable[b]]
	})
	for _, i := range stable {
		s.mention(s.ltoks[i])
	}
	s.drain()
	// 5. What nothing mentions.
	var rest []*record
	for _, r := range all {
		if _, ok := s.fresh[r.kind][r.old]; !ok {
			rest = append(rest, r)
		}
	}
	keys := map[*record]string{}
	for _, r := range rest {
		keys[r] = s.render(r.toks[1:])
	}
	sort.SliceStable(rest, func(a, b int) bool {
		if rest[a].kind != rest[b].kind {
			return strings.IndexByte("TGY", rest[a].kind) < strings.IndexByte("TGY", rest[b].kind)
		}
		return keys[rest[a]] < keys[rest[b]]
	})
	for _, r := range rest {
		s.assign(r.kind, r.old)
		s.drain()
	}
	// Output.
	for _, i := range head {
		if s.ltoks[i] != nil {
			fmt.Fprintln(w, s.render(s.ltoks[i]))
		} else {
			fmt.Fprintln(w, s.lines[i])
		}
	}
	for _, sec := range []struct {
		name string
		kind byte
	}{{"types", 'T'}, {"signatures", 'G'}, {"symbols", 'Y'}} {
		fmt.Fprintf(w, "== %s\n", sec.name)
		recs := make([]*record, 0, len(s.recs[sec.kind]))
		for _, r := range s.recs[sec.kind] {
			recs = append(recs, r)
		}
		sort.Slice(recs, func(a, b int) bool { return s.fresh[sec.kind][recs[a].old] < s.fresh[sec.kind][recs[b].old] })
		for _, r := range recs {
			fmt.Fprintf(w, "%c%d%s\n", r.kind, s.fresh[r.kind][r.old], s.render(r.toks[1:]))
		}
	}
	fmt.Fprintf(w, "== links\n")
	byStore := map[int][]string{}
	for _, i := range linkLines {
		byStore[rank[storeOf(i)]] = append(byStore[rank[storeOf(i)]], s.render(s.ltoks[i]))
	}
	for k := 0; k < len(rank); k++ {
		sort.Strings(byStore[k])
		for _, l := range byStore[k] {
			fmt.Fprintln(w, l)
		}
	}
	fmt.Fprintf(w, "== diagnostics\n")
	for _, i := range diags {
		fmt.Fprintln(w, s.lines[i])
	}
}
