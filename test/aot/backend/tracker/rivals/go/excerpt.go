package main

import "strings"

// The first words of a text.
func summary(text string, most int) string {
	words := strings.Fields(text)
	if len(words) <= most {
		return strings.Join(words, " ")
	}
	return strings.Join(words[:most], " ") + " ..."
}

func beginsWithTerm(word string, terms []string) bool {
	lower := strings.ToLower(word)
	for _, term := range terms {
		if strings.HasPrefix(lower, term) {
			return true
		}
	}
	return false
}

// Some thirty words around the first one that begins with a term that was searched for, with those words marked.
func writeMarkedExcerpt(w *page, text string, terms []string) {
	words := strings.Fields(text)
	first := 0
	for i, word := range words {
		if beginsWithTerm(word, terms) {
			first = i
			break
		}
	}
	from := max(0, first-8)
	to := min(len(words), from+30)
	if from > 0 {
		w.WriteString("... ")
	}
	for i, word := range words[from:to] {
		if i > 0 {
			w.WriteByte(' ')
		}
		if beginsWithTerm(word, terms) {
			wrapped(w, "<mark>", word, "</mark>")
		} else {
			escape(w, word)
		}
	}
	if to < len(words) {
		w.WriteString(" ...")
	}
}
