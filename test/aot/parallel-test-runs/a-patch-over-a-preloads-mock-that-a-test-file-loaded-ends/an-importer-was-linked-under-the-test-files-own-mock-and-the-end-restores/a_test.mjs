import { jest, mock, test, vi } from 'bun:test'
test('it', async () => {
    const said = []
    said.push(require('./g.cjs').word)
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    const h = await import('./h.mjs')
    said.push(h.read())
    vi.doUnmock('./g.cjs')
    const n = await import('./n.mjs')
    said.push(h.read(), n.read())
    mock.module('./g.cjs', () => ({ word: 'patch' }))
    said.push(h.read(), n.read())
    vi.doUnmock('./g.cjs')
    said.push(h.read(), n.read())
    console.log('SAID z3', said.join(' | '), globalThis.runs ?? 0)
})
