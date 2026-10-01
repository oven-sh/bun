RESEARCH "regexpp-port": the base of the seven regex rules of D3. Nothing here is in the tree.

Upstream: eslint-community/regexpp, tag v4.12.2 = commit 11f93e01a21638fc2b95dfcd750ff1385ed9c5f1 (MIT), the version that
ESLint 10.11.0 at the pin resolves (^4.12.2). Sources: /workspace/ref/regexpp (restored by ../../tools/eslint-oracle-setup.sh,
under its flock). The built package that ESLint runs: /workspace/ref/eslint/node_modules/@eslint-community/regexpp.

make-fixtures.cjs   node make-fixtures.cjs <out dir>
                    literal.txt (5746 cases: 5069 ASTs as a hash of upstream's baseline, 677 errors) and visitor.txt (418
                    histories as a hash) from upstream's own test/fixtures. The line format is at the top of the script.
make-extra.cjs      node make-extra.cjs <out dir>
                    extra.txt: 256 sources that upstream's fixtures lack (unpaired surrogates, numbers beyond 2^53, Annex B
                    corners, the flag v, modifiers, duplicate names, texts that are no literal), each as a literal under four
                    option sets and as a pattern under the four pairs of u and v. Answers: regexpp at the pin.
dump-spec.cjs       node dump-spec.cjs
                    the canonical text of an AST (what the hashes are of) written from tables of the fields of each node
                    type, as the test-only writer in Rust has to write it. Checks itself: 5069 ASTs, 677 errors, 418
                    histories, 0 wrong.
check-rule-from-literal.cjs   node check-rule-from-literal.cjs <literal.txt>
                    what a bun:test can derive from literal.txt for no-invalid-regexp (one line `new RegExp(p, f);` per
                    case of ES2025) against ESLint at the pin: 4669 lines, 318 reports, 0 wrong.
