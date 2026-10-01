// ---- the probe: reads cases, prints the sorted and deduplicated list and the result of each function for each pair

type reader struct {
	tokens []string
	pos    int
}

func (r *reader) next() string {
	t := r.tokens[r.pos]
	r.pos++
	return t
}

func (r *reader) int() int {
	n, err := strconv.Atoi(r.next())
	if err != nil {
		panic(err)
	}
	return n
}

func (r *reader) str() string {
	t := r.next()
	b, err := hex.DecodeString(t[1:])
	if err != nil {
		panic(err)
	}
	return string(b)
}

func (r *reader) chain() []*Diagnostic {
	n := r.int()
	var out []*Diagnostic
	for range n {
		text := r.str()
		next := r.chain()
		out = append(out, &Diagnostic{code: 1, messageArgs: []string{text}, messageChain: next})
	}
	return out
}

func (r *reader) diag(files []*SourceFile) *Diagnostic {
	d := &Diagnostic{}
	if file := r.int(); file >= 0 {
		d.file = files[file]
	}
	start := r.int()
	length := r.int()
	d.loc = NewTextRange(start, start+length)
	d.category = Category(r.int())
	switch r.next() {
	case "T":
		d.code = int32(r.int())
	case "N":
		d.source = r.str()
	default:
		panic("code kind")
	}
	d.messageText = r.str()
	d.messageChain = r.chain()
	n := r.int()
	for range n {
		d.relatedInformation = append(d.relatedInformation, r.diag(files))
	}
	return d
}

func hx(s string) string { return "x" + hex.EncodeToString([]byte(s)) }

func serChain(sb *strings.Builder, chain []*Diagnostic) {
	sb.WriteString("[")
	for _, c := range chain {
		sb.WriteString(hx(c.messageArgs[0]))
		serChain(sb, c.messageChain)
	}
	sb.WriteString("]")
}

func ser(sb *strings.Builder, d *Diagnostic) {
	sb.WriteString("(")
	if d.file != nil {
		sb.WriteString(hx(d.file.fileName))
	} else {
		sb.WriteString("-")
	}
	fmt.Fprintf(sb, ",%d,%d,%d,%d,%s,%s,", d.Pos(), d.End()-d.Pos(), d.category, d.code, hx(d.source), hx(d.messageText))
	serChain(sb, d.messageChain)
	sb.WriteString("{")
	for _, r := range d.relatedInformation {
		ser(sb, r)
	}
	sb.WriteString("})")
}

func sign(c int) int {
	if c < 0 {
		return -1
	}
	if c > 0 {
		return 1
	}
	return 0
}

func b(v bool) int {
	if v {
		return 1
	}
	return 0
}

func main() {
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	r := &reader{tokens: strings.Fields(string(data))}
	out := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer out.Flush()
	cases := r.int()
	for i := range cases {
		nfiles := r.int()
		var files []*SourceFile
		for range nfiles {
			files = append(files, &SourceFile{fileName: r.str()})
		}
		ndiags := r.int()
		var diags []*Diagnostic
		for range ndiags {
			diags = append(diags, r.diag(files))
		}
		fmt.Fprintf(out, "CASE %d\n", i)
		for x := range diags {
			for y := x + 1; y < len(diags); y++ {
				fmt.Fprintf(out, "P %d %d %d %d\n",
					sign(CompareDiagnostics(diags[x], diags[y])), sign(CompareDiagnostics(diags[y], diags[x])),
					b(EqualDiagnostics(diags[x], diags[y])), b(EqualDiagnosticsNoRelatedInfo(diags[x], diags[y])))
			}
		}
		for _, d := range SortAndDeduplicateDiagnostics(diags) {
			var sb strings.Builder
			ser(&sb, d)
			fmt.Fprintf(out, "S %s\n", sb.String())
		}
	}
}
