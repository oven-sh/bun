import { jest, mock, test, vi } from 'bun:test'
const key = require.resolve('./g.cjs')
test('it', async () => {
    const said = []
    said.push(require('./g.cjs').word)
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    const h = await import('./h.mjs')
    delete require.cache[key]
    const again = await import('./h.mjs')
    const n = await import('./n.mjs')
    said.push(h.read(), again.read(), again === h, n.read(), require('./g.cjs').word, h.read())
    console.log('SAID f3', said.join(' | '), globalThis.runs ?? 0)
})
