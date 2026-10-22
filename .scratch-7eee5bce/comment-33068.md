#NNNN gives `assert.deepEqual` and `assert.notDeepEqual` Node's loose relation in the native comparator, as asked on #34660 (https://github.com/oven-sh/bun/pull/34660#discussion_r3634306299). It also pairs Set and Map members one to one for `assert.deepStrictEqual`. It covers #23877 and #28760, the two issues of this PR.

If #NNNN lands, this PR can close.
