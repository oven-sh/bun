package main

import (
	"encoding/json"
	"strconv"
	"unicode/utf8"
)

// A property of a JSON object that may be missing, null, or have a value.
type field[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (f *field[T]) UnmarshalJSON(data []byte) error {
	f.Set = true
	if string(data) == "null" {
		f.Null = true
		return nil
	}
	return json.Unmarshal(data, &f.Value)
}

func given[T any](value T) field[T] {
	return field[T]{Set: true, Value: value}
}

// What comes in for a new issue or for a change to one.
type issueInput struct {
	Title    field[string]    `json:"title"`
	Body     field[string]    `json:"body"`
	Priority field[int]       `json:"priority"`
	Labels   field[[]*string] `json:"labels"`
	Assignee field[string]    `json:"assignee"`
	State    field[string]    `json:"state"`
}

type commentInput struct {
	Body     field[string] `json:"body"`
	ParentID field[int]    `json:"parentId"`
}

// Where a value is wrong. malformed: something has another type than it should have, or is missing.
type refusal struct {
	invalid   []string
	malformed bool
}

func (r *refusal) wrong(path string) {
	r.invalid = append(r.invalid, path)
}

func (r *refusal) wrongType(path string) {
	r.invalid = append(r.invalid, path)
	r.malformed = true
}

// The length of a string as JavaScript counts it.
func utf16Length(text string) int {
	n := 0
	for i := 0; i < len(text); {
		c, size := utf8.DecodeRuneInString(text[i:])
		i += size
		n++
		if c > 0xFFFF {
			n++
		}
	}
	return n
}

func (r *refusal) text(path string, f field[string], required bool, least, most int) {
	if !f.Set && !required {
		return
	}
	if !f.Set || f.Null {
		r.wrongType(path)
	} else if n := utf16Length(f.Value); n < least || n > most {
		r.wrong(path)
	}
}

func (r *refusal) whole(path string, f field[int], required bool, least, most int) {
	if !f.Set && !required {
		return
	}
	if !f.Set || f.Null {
		r.wrongType(path)
	} else if f.Value < least || f.Value > most {
		r.wrong(path)
	}
}

func isLogin(text string) bool {
	return len(text) >= 1 && len(text) <= 60 && endOfRun(text, 0, isLoginCharacter) == len(text)
}

func (input *issueInput) check(required bool) refusal {
	var r refusal
	r.text("title", input.Title, required, 1, 200)
	r.text("body", input.Body, required, 0, 20000)
	r.whole("priority", input.Priority, required, 0, 3)
	if input.Labels.Set || required {
		if !input.Labels.Set || input.Labels.Null {
			r.wrongType("labels")
		} else {
			if len(input.Labels.Value) > 12 {
				r.wrong("labels")
			}
			for i, name := range input.Labels.Value {
				if name == nil {
					r.wrongType("labels." + strconv.Itoa(i))
				} else if n := utf16Length(*name); n < 1 || n > 50 {
					r.wrong("labels." + strconv.Itoa(i))
				}
			}
		}
	}
	if input.Assignee.Set && !input.Assignee.Null && !isLogin(input.Assignee.Value) {
		r.wrong("assignee")
	}
	if !required && input.State.Set && (input.State.Null || input.State.Value != "open" && input.State.Value != "closed") {
		r.wrongType("state")
	}
	return r
}

func (input *issueInput) labelNames() []string {
	names := make([]string, len(input.Labels.Value))
	for i, name := range input.Labels.Value {
		names[i] = *name
	}
	return names
}

func (input *commentInput) check() refusal {
	var r refusal
	r.text("body", input.Body, true, 1, 20000)
	if input.ParentID.Set && !input.ParentID.Null {
		r.whole("parentId", input.ParentID, true, 1, 2147483647)
	}
	return r
}
