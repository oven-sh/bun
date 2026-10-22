**Status**

Reproduced on main against Node v26.3.0:

- #23877: `assert.deepEqual('+00000000', false)` throws on Bun and passes on Node.
- #28760: `assert.deepStrictEqual(new Set([{a:1},{a:1},{a:2}]), new Set([{a:1},{a:2},{a:2}]))` passes on Bun and throws on Node.
- Of the 330 rows of `test/js/node/assert/deep-equal-cases.ts`, main gives a wrong `deepEqual` verdict on 145 and a wrong `deepStrictEqual` verdict on 32.

PR: #NNNN
