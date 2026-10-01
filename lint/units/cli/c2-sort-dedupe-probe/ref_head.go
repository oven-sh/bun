// Oracle: run.sh appends the functions of typescript-go 89d5d5b that it cuts out by line number; only the package qualifiers are removed.
package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
)

type TextPos int32

type TextRange struct {
	pos TextPos
	end TextPos
}

func NewTextRange(pos int, end int) TextRange {
	return TextRange{pos: TextPos(pos), end: TextPos(end)}
}

func (t TextRange) Pos() int {
	return int(t.pos)
}

func (t TextRange) End() int {
	return int(t.end)
}

func (t TextRange) Len() int {
	return int(t.end - t.pos)
}

type Category int32

type Key string

type Message struct{ text string }

func (m *Message) String() string { return m.text }

type RepopulateDiagnosticInfo struct{}

type SourceFile struct{ fileName string }

func (f *SourceFile) FileName() string { return f.fileName }

