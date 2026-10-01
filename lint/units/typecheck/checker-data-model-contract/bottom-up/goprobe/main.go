package main

import (
	"fmt"
	"slices"
)

func Same[T any](s1 []T, s2 []T) bool {
	if len(s1) == len(s2) {
		return len(s1) == 0 || &s1[0] == &s2[0]
	}
	return false
}

func Filter[T any](slice []T, f func(T) bool) []T {
	for i, value := range slice {
		if !f(value) {
			result := slices.Clone(slice[:i])
			for i++; i < len(slice); i++ {
				value = slice[i]
				if f(value) {
					result = append(result, value)
				}
			}
			return result
		}
	}
	return slice
}

type mapper struct{ sources, targets []int }

func (m *mapper) Map(t int) int {
	for i, s := range m.sources {
		if t == s {
			return m.targets[i]
		}
	}
	return t
}

func main() {
	s := []int{1, 2, 3}
	fmt.Println("clip same:", Same(slices.Clip(s[:2]), slices.Clip(s[:2])), "tail same:", Same(s[2:], s[2:]), "copy same:", Same(s, slices.Clone(s)))
	var nilSlice []int
	fmt.Println("clone nil is nil:", slices.Clone(nilSlice) == nil, "clone empty is nil:", slices.Clone(s[:0]) == nil)
	fmt.Println("filter all kept same:", Same(Filter(s, func(int) bool { return true }), s))
	none := Filter(s, func(int) bool { return false })
	fmt.Println("filter none kept: nil:", none == nil, "len:", len(none))
	fmt.Println("empty vs nil same:", Same(nilSlice, []int{}))
	// fillMissingTypeArguments: the mapper holds the slice that later rounds write.
	params := []int{10, 20, 30}
	result := make([]int, 3)
	for i := range result {
		result[i] = -1
	}
	var mappers []*mapper
	for i := range result {
		m := &mapper{params, result}
		mappers = append(mappers, m)
		if i == 1 {
			result[i] = m.Map(30)
		} else {
			result[i] = 100 + i
		}
	}
	fmt.Println("result:", result, "mapper of round 1 maps 30 to:", mappers[1].Map(30))
}
