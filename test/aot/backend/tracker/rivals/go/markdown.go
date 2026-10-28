package main

import "strings"

// A small subset of Markdown: headings, paragraphs, lists, quotations, fenced code, and in a line: `code`, **strong**, *emphasis*,
// [links](https://..), @mentions and #123 references to issues of the same project.

func isDigit(c byte) bool {
	return c >= '0' && c <= '9'
}

func isLoginCharacter(c byte) bool {
	return c >= 'a' && c <= 'z' || isDigit(c) || c == '-'
}

func isWordCharacter(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || isDigit(c) || c == '_'
}

func endOfRun(text string, from int, belongs func(byte) bool) int {
	end := from
	for end < len(text) && belongs(text[end]) {
		end++
	}
	return end
}

// The place of what is looked for at or behind from, or -1.
func indexFrom(text, wanted string, from int) int {
	if from > len(text) {
		return -1
	}
	if i := strings.Index(text[from:], wanted); i >= 0 {
		return from + i
	}
	return -1
}

func wrapped(w *page, open, text, close string) {
	w.WriteString(open)
	escape(w, text)
	w.WriteString(close)
}

func renderInline(w *page, text, projectSlug string) {
	plainFrom, at := 0, 0
	for at < len(text) {
		end := -1
		switch c := text[at]; c {
		case '`':
			if close := indexFrom(text, "`", at+1); close > at+1 {
				escape(w, text[plainFrom:at])
				wrapped(w, "<code>", text[at+1:close], "</code>")
				end = close + 1
			}
		case '*':
			if at+1 < len(text) && text[at+1] == '*' {
				if close := indexFrom(text, "**", at+2); close > at+2 {
					escape(w, text[plainFrom:at])
					wrapped(w, "<strong>", text[at+2:close], "</strong>")
					end = close + 2
				}
			} else if close := indexFrom(text, "*", at+1); close > at+1 {
				escape(w, text[plainFrom:at])
				wrapped(w, "<em>", text[at+1:close], "</em>")
				end = close + 1
			}
		case '[':
			middle := indexFrom(text, "](", at+1)
			if middle > at+1 {
				if close := indexFrom(text, ")", middle+2); close > middle+2 {
					url := text[middle+2 : close]
					if strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "http://") {
						escape(w, text[plainFrom:at])
						wrapped(w, `<a href="`, url, `" rel="nofollow">`)
						wrapped(w, "", text[at+1:middle], "</a>")
						end = close + 1
					}
				}
			}
		case '@', '#':
			if at == 0 || !isWordCharacter(text[at-1]) {
				belongs := isDigit
				if c == '@' {
					belongs = isLoginCharacter
				}
				if stop := endOfRun(text, at+1, belongs); stop > at+1 {
					name := text[at+1 : stop]
					escape(w, text[plainFrom:at])
					if c == '@' {
						w.WriteString(`<a class="mention" href="/u/`)
						w.WriteString(name)
						w.WriteString(`">@`)
					} else {
						w.WriteString(`<a class="reference" href="/p/`)
						w.WriteString(projectSlug)
						w.WriteString(`/issues/`)
						w.WriteString(name)
						w.WriteString(`">#`)
					}
					w.WriteString(name)
					w.WriteString(`</a>`)
					end = stop
				}
			}
		}
		if end < 0 {
			at++
		} else {
			at, plainFrom = end, end
		}
	}
	escape(w, text[plainFrom:])
}

func isOrderedItem(line string) bool {
	end := endOfRun(line, 0, isDigit)
	return end > 0 && strings.HasPrefix(line[end:], ". ")
}

func isFence(line string) bool      { return strings.HasPrefix(line, "```") }
func isQuotation(line string) bool  { return strings.HasPrefix(line, "> ") }
func isBulletItem(line string) bool { return strings.HasPrefix(line, "- ") }
func isHeading(line string) bool {
	return strings.HasPrefix(line, "# ") || strings.HasPrefix(line, "## ") || strings.HasPrefix(line, "### ")
}

func isParagraphLine(line string) bool {
	return line != "" && !isFence(line) && !isHeading(line) && !isQuotation(line) && !isBulletItem(line) && !isOrderedItem(line)
}

func renderMarkdown(w *page, source, projectSlug string) {
	lines := strings.Split(source, "\n")
	at := 0

	// How many lines from here on belong to one block.
	run := func(belongs func(string) bool) []string {
		from := at
		for at < len(lines) && belongs(lines[at]) {
			at++
		}
		return lines[from:at]
	}
	joined := func(taken []string, skip int) string {
		if skip > 0 {
			shortened := make([]string, len(taken))
			for i, line := range taken {
				shortened[i] = line[skip:]
			}
			taken = shortened
		}
		return strings.Join(taken, "\n")
	}
	items := func(open string, taken []string, skip func(string) int, close string) {
		w.WriteString(open)
		for _, line := range taken {
			w.WriteString("<li>")
			renderInline(w, line[skip(line):], projectSlug)
			w.WriteString("</li>")
		}
		w.WriteString(close)
	}

	for at < len(lines) {
		line := lines[at]
		switch {
		case line == "":
			at++
		case isFence(line):
			at++
			code := run(func(line string) bool { return !isFence(line) })
			at++
			wrapped(w, "<pre><code>", joined(code, 0), "</code></pre>\n")
		case isHeading(line):
			level := strings.IndexByte(line, ' ')
			w.WriteString("<h")
			writeInt(w, level+2)
			w.WriteByte('>')
			renderInline(w, line[level+1:], projectSlug)
			w.WriteString("</h")
			writeInt(w, level+2)
			w.WriteString(">\n")
			at++
		case isQuotation(line):
			w.WriteString("<blockquote><p>")
			renderInline(w, joined(run(isQuotation), 2), projectSlug)
			w.WriteString("</p></blockquote>\n")
		case isBulletItem(line):
			items("<ul>", run(isBulletItem), func(string) int { return 2 }, "</ul>\n")
		case isOrderedItem(line):
			items("<ol>", run(isOrderedItem), func(line string) int { return strings.IndexByte(line, ' ') + 1 }, "</ol>\n")
		default:
			w.WriteString("<p>")
			renderInline(w, joined(run(isParagraphLine), 0), projectSlug)
			w.WriteString("</p>\n")
		}
	}
}
