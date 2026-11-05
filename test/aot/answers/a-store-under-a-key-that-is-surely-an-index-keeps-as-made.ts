// answers: without-library
// # A store under a number that is no index lays a NAME on the list and takes it out of the Structure that its class made it in. Link knows of a key that it holds only numbers, never that it is an index: Scan says so where the key is written so: a whole number from 0, `x & n`, `x >>> n` from 1 on, `x % n` of such a key.
// # Under such a key the list keeps the word that it stays as made: it is taken, and held against the list: no closed read of indexOf.
// # `list[i - 1]` lays "-1" in the first turn: no word, a closed read, and no stop: what ends the word lies in a slot of its own, so the elements keep their types and nothing is found under names.
// # f1 = masked, f2 = shifted, f3 = wrapped, f4 = written, f5 = counted
// # RUN(MASKED): walk f1 mechanisms=all
// # MASKED: CheckProof {{*}}checkedType=true
// # RUN(MASKEDREADS): walk f1 mechanisms=all
// # MASKEDREADS-NOT: key="indexOf"
// # RUN(SHIFTED): walk f2 mechanisms=all
// # SHIFTED: CheckProof {{*}}checkedType=true
// # RUN(SHIFTEDREADS): walk f2 mechanisms=all
// # SHIFTEDREADS-NOT: key="indexOf"
// # RUN(WRAPPED): walk f3 mechanisms=all
// # WRAPPED: CheckProof {{*}}checkedType=true
// # RUN(WRAPPEDREADS): walk f3 mechanisms=all
// # WRAPPEDREADS-NOT: key="indexOf"
// # RUN(WRITTEN): walk f4 mechanisms=all
// # WRITTEN: CheckProof {{*}}checkedType=true
// # RUN(WRITTENREADS): walk f4 mechanisms=all
// # WRITTENREADS-NOT: key="indexOf"
// # RUN(COUNTED): walk f5 mechanisms=all
// # COUNTED: key="indexOf"
// # RUN(COUNTEDHELD): walk f5 mechanisms=all
// # COUNTEDHELD-NOT: CheckProof {{*}}checkedType=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
function masked(list: number[], turns: number): number { for (let i = 0; i < turns; i++) list[i & 7] = i; return list.indexOf(19); }
function shifted(list: number[], turns: number): number { for (let i = 0; i < turns; i++) list[(i * 40503) >>> 29] = i; return list.indexOf(19); }
function wrapped(list: number[], turns: number): number { for (let i = 0; i < turns; i++) list[(i & 1023) % 8] = i; return list.indexOf(19); }
function written(list: number[], turns: number): number { for (let i = 0; i < turns; i++) list[3] = i; return list.indexOf(19); }
function counted(list: number[], turns: number): number { for (let i = 0; i < turns; i++) list[i - 1] = i; return list.indexOf(19) + Object.keys(list).length; }
report(masked([0, 0, 0, 0, 0, 0, 0, 0], 20));
report(shifted([0, 0, 0, 0, 0, 0, 0, 0], 20));
report(wrapped([0, 0, 0, 0, 0, 0, 0, 0], 20));
report(written([0, 0, 0, 0, 0, 0, 0, 0], 20));
report(counted([0, 0, 0, 0, 0, 0, 0, 0], 20));
report("end");
