package main

import (
	"bytes"
	"strconv"
	"time"
)

// A page is written into one buffer from beginning to end.
type page = bytes.Buffer

func writeInt(w *page, n int) {
	w.Write(strconv.AppendInt(w.AvailableBuffer(), int64(n), 10))
}

// Oct 16, 2026
func writeDay(w *page, t timestamp) {
	w.Write(time.Time(t).UTC().AppendFormat(w.AvailableBuffer(), "Jan 2, 2006"))
}

// Oct 16, 2026, 13:45
func writeMinute(w *page, t timestamp) {
	w.Write(time.Time(t).UTC().AppendFormat(w.AvailableBuffer(), "Jan 2, 2006, 15:04"))
}

// 1,234,567
func writeNumber(w *page, n int) {
	var digits [20]byte
	text := strconv.AppendInt(digits[:0], int64(n), 10)
	for i, digit := range text {
		if i > 0 && (len(text)-i)%3 == 0 && text[i-1] != '-' {
			w.WriteByte(',')
		}
		w.WriteByte(digit)
	}
}

// 1 comment, 2 comments, 1,234 comments
func writeCount(w *page, n int, singular string) {
	writeNumber(w, n)
	w.WriteByte(' ')
	w.WriteString(singular)
	if n != 1 {
		w.WriteByte('s')
	}
}

func writeTimeTag(w *page, t timestamp, text func(*page, timestamp)) {
	w.WriteString(`<time datetime="`)
	w.Write(time.Time(t).UTC().AppendFormat(w.AvailableBuffer(), isoLayout))
	w.WriteString(`">`)
	text(w, t)
	w.WriteString(`</time>`)
}

func escape(w *page, text string) {
	from := 0
	for i := 0; i < len(text); i++ {
		var entity string
		switch text[i] {
		case '&':
			entity = "&amp;"
		case '<':
			entity = "&lt;"
		case '>':
			entity = "&gt;"
		case '"':
			entity = "&quot;"
		case '\'':
			entity = "&#x27;"
		default:
			continue
		}
		w.WriteString(text[from:i])
		w.WriteString(entity)
		from = i + 1
	}
	w.WriteString(text[from:])
}
