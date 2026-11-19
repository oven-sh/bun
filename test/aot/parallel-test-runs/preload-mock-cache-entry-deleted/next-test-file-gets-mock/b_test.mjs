import { test } from 'bun:test'
test('it', async () => {
    const said = [require('./g.cjs').word, (await import('./g.cjs')).word, (await import('./h.mjs')).read()]
    console.log('SAID e6 b', said.join(' | '), globalThis.runs ?? 0)
})
