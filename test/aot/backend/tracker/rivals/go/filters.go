package main

import (
	"net/url"
	"strconv"
	"strings"
)

type issueFilters struct {
	State   string  `json:"state"`
	Label   *string `json:"label"`
	Sort    string  `json:"sort"`
	Page    int     `json:"page"`
	PerPage int     `json:"perPage"`
}

// The whole number that the text begins with, as JavaScript's parseInt reads it, held between least and most.
func wholeNumber(text string, fallback, least, most int) int {
	text = strings.TrimLeft(text, " \t\n\r\v\f")
	negative := strings.HasPrefix(text, "-")
	if negative || strings.HasPrefix(text, "+") {
		text = text[1:]
	}
	end := endOfRun(text, 0, isDigit)
	if end == 0 {
		return fallback
	}
	n, err := strconv.Atoi(text[:end])
	if err != nil {
		n = most
		if negative {
			return least
		}
	}
	if negative {
		n = -n
	}
	return min(max(n, least), most)
}

// The number that a part of a path spells, if it is one that a row can have; otherwise 0.
func positiveInteger(text string) int32 {
	if len(text) == 0 || len(text) > 9 || text[0] == '0' || endOfRun(text, 0, isDigit) != len(text) {
		return 0
	}
	n, _ := strconv.Atoi(text)
	return int32(n)
}

func parseFilters(params url.Values, perPage, mostPerPage int) issueFilters {
	filters := issueFilters{State: "open", Sort: "updated", Page: 1, PerPage: perPage}
	if params.Get("state") == "closed" {
		filters.State = "closed"
	}
	if name := params.Get("label"); name != "" {
		filters.Label = &name
	}
	if sort := params.Get("sort"); sort == "created" || sort == "comments" {
		filters.Sort = sort
	}
	if params.Has("page") {
		filters.Page = wholeNumber(params.Get("page"), 1, 1, 100_000)
	}
	if params.Has("per_page") {
		filters.PerPage = wholeNumber(params.Get("per_page"), perPage, 1, mostPerPage)
	}
	return filters
}

// application/x-www-form-urlencoded, as browsers and URLSearchParams spell it.
func appendFormEncoded(to []byte, text string) []byte {
	const hex = "0123456789ABCDEF"
	for i := 0; i < len(text); i++ {
		switch c := text[i]; {
		case c == ' ':
			to = append(to, '+')
		case isWordCharacter(c) || c == '*' || c == '-' || c == '.':
			to = append(to, c)
		default:
			to = append(to, '%', hex[c>>4], hex[c&15])
		}
	}
	return to
}

// The address of the list of a project's issues under these filters. What is as by default is left out.
func issueListURL(projectSlug string, filters issueFilters) string {
	address := make([]byte, 0, 96)
	address = append(address, "/p/"...)
	address = append(address, projectSlug...)
	address = append(address, "/issues"...)
	separator := byte('?')
	add := func(name, value string) {
		address = append(address, separator)
		address = append(address, name...)
		address = append(address, '=')
		address = appendFormEncoded(address, value)
		separator = '&'
	}
	if filters.State != "open" {
		add("state", filters.State)
	}
	if filters.Label != nil {
		add("label", *filters.Label)
	}
	if filters.Sort != "updated" {
		add("sort", filters.Sort)
	}
	if filters.Page != 1 {
		add("page", strconv.Itoa(filters.Page))
	}
	return string(address)
}
