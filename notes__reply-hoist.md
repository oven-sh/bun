On the additional finding (a type of a type-only module that only a stated member names): 6f57457618 adds it. The hoist queue in `link` now also takes the types that a stated member names, as it does for `references`. It takes no value: a class of another output would come as a twin, and `link` refuses a twin as the type of a member.

The test is "a stated type brings a type that nothing else in the bundle names" in `test/aot/typed-file-unannotated-members.test.ts`. The typed file there has `interface Hidden { h: string }` and `declare hidden: Hidden;`. It fails on b04025086d, which wrote `declare hidden;`.

The three inline findings are fixed in the same commit, and the threads have the details.
