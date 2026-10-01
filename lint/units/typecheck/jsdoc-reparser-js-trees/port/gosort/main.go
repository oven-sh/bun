package main

import (
	"fmt"
	"slices"
)

type el struct{ key, id int }

func main() {
	// a simple LCG so that the Rust test can make the same inputs
	state := uint64(12345)
	next := func() uint64 {
		state = state*6364136223846793005 + 1442695040888963407
		return state >> 33
	}
	for _, n := range []int{0, 1, 2, 5, 12, 13, 20, 49, 50, 51, 64, 100, 257, 1000} {
		for _, keys := range []int{1, 2, 3, 7, 1000} {
			for _, shape := range []int{0, 1, 2} {
				data := make([]el, n)
				for i := range data {
					k := int(next() % uint64(keys))
					if shape == 1 {
						k = i * keys / (n + 1)
					} else if shape == 2 {
						k = (n - i) * keys / (n + 1)
					}
					data[i] = el{k, i}
				}
				slices.SortFunc(data, func(a, b el) int { return a.key - b.key })
				sum := uint64(1469598103934665603)
				for _, e := range data {
					sum = (sum ^ uint64(e.id)) * 1099511628211
				}
				fmt.Printf("%d %d %d %d\n", n, keys, shape, sum)
			}
		}
	}
}
