// The kernels of main.ts in Go. `field`, `rare`, `closure` and `closure32` have no separate Go form: compare them with `copy` and `scan`.
package main

import (
	"fmt"
	"os"
	"strconv"
)

//go:noinline
func copyBytes(text string, bytes []byte) int {
	at := 0
	for i := 0; i < len(text); i++ {
		if c := text[i]; c < 0x80 {
			bytes[at] = c
			at++
		}
	}
	return at
}

//go:noinline
func escape(text string, bytes []byte) int {
	at := 0
	for i := 0; i < len(text); i++ {
		c := text[i]
		if c == '&' {
			at += copy(bytes[at:], "&amp;")
		} else if c != '<' && c != '>' && c != '"' && c != '\'' {
			bytes[at] = c
			at++
		}
	}
	return at
}

//go:noinline
func scan(text string) int {
	found, at := 0, 0
	for at < len(text) {
		switch text[at] {
		case '`', '*', '[', '@', '#':
			found++
		}
		at++
	}
	return found + at
}

//go:noinline
func sum(bytes []byte) int {
	total := 0
	for i := 0; i < 4096; i++ {
		total += int(bytes[i])
	}
	return total
}

func main() {
	const phrase = "the quick brown fox jumps over the lazy dog, again & again. "
	made := make([]byte, 4096)
	for i := range made {
		made[i] = phrase[i%60]
	}
	text, bytes := string(made), make([]byte, 8192)
	rounds, _ := strconv.Atoi(os.Args[2])
	result := 0
	for ; rounds > 0; rounds-- {
		switch os.Args[1] {
		case "copy":
			result = copyBytes(text, bytes)
		case "escape":
			result = escape(text, bytes)
		case "scan", "scan32":
			result = scan(text)
		default:
			result = sum(bytes)
		}
	}
	fmt.Println(os.Args[1], result)
}
