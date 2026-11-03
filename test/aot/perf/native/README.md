The idioms of `../everyday` written in other languages, to hold the compiled TypeScript against: the same element types, data whose lengths are known at run time only, and the bounds tests that each language gives by itself. No test runs them.

`loops-over-lists-and-typed-arrays.{c,go}`: `clang -O2` | `go build`; `AOT_PERF_TURNS=<n> ./loops <name of the idiom>` runs n turns. Instructions a turn are counted as for the idioms: a run of n turns less a run of n / 4, over 3n / 4.
