RESEARCH "regexpp-port": the base of the seven regex rules of D3. Nothing here is in the tree.

Upstream: eslint-community/regexpp, tag v4.12.2 = commit 11f93e01a21638fc2b95dfcd750ff1385ed9c5f1 (MIT), the version that
ESLint 10.11.0 at the pin resolves (^4.12.2). Sources: /workspace/ref/regexpp (restored by ../../tools/eslint-oracle-setup.sh,
under its flock). The built package that ESLint runs: /workspace/ref/eslint/node_modules/@eslint-community/regexpp.

make-fixtures.cjs   node make-fixtures.cjs <out dir>
                    literal.txt (regexpp's own 1093 cases), test262.txt (the 4653 cases that upstream took from test262: BSD,
                    its notice is test/fixtures/parser/literal/test262/LICENSE of the checkout) and visitor.txt (418
                    histories), from upstream's own test/fixtures: 5069 ASTs and every history as a hash of upstream's
                    baseline, 677 errors as index and message. The line format is at the top of the script.
make-extra.cjs      node make-extra.cjs <out dir>
                    extra.txt: 256 sources that upstream's fixtures lack (unpaired surrogates, numbers beyond 2^53, Annex B
                    corners, the flag v, modifiers, duplicate names, texts that are no literal), each as a literal under four
                    option sets and as a pattern under the four pairs of u and v. Answers: regexpp at the pin.
dump-spec.cjs       node dump-spec.cjs
                    the canonical text of an AST (what the hashes are of) written from tables of the fields of each node
                    type, as the test-only writer in Rust has to write it. Checks itself: 5069 ASTs, 677 errors, 418
                    histories, 0 wrong.
check-rule-from-literal.cjs   node check-rule-from-literal.cjs <literal.txt> <test262.txt>
                    what a bun:test can derive from literal.txt for no-invalid-regexp (one line `new RegExp(p, f);` per
                    case of ES2025) against ESLint at the pin: 4669 lines, 318 reports, 0 wrong.

../oracle/ is the work of the other pass of this research (an AST written out on one line instead of a hash, random
patterns, the unicode tables as Rust items). The two passes agree on the closed form of BranchID.separatedFrom.

shape.rs            rustc --edition 2024 --crate-type lib shape.rs; rustc --edition 2024 --test shape.rs -o t && ./t
                    NOT the port: 180 lines that show that the proposed shape compiles under deny(warnings, dead_code,
                    unreachable_pub): a `pub mod regexpp` whose items nothing outside a test calls, the callbacks as a trait
                    object with `Result` and default bodies, a validator that borrows the source and the callbacks, a parser
                    that makes its state and its validator per call and returns an arena of nodes, `?` inside `||` and `&&`.
