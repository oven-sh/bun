import { jest, mock, test, vi } from 'bun:test'
const key = require.resolve('./g.cjs')
test('it', async () => {
    const said = []
    const h = await import('./h.mjs')
    said.push(h.read(), require('./g.cjs').word)
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    delete require.cache[key]
    said.push(h.read(), (await import('./g.cjs')).word)
    const n = await import('./n.mjs')
    said.push(n.read(), require('./g.cjs').word, h.read())
    console.log('SAID e2', said.join(' | '), globalThis.runs ?? 0)
})
