import { mock, test, vi } from 'bun:test'
test('it', async () => {
    const said = []
    said.push(require('./g.cjs').word)
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    delete require.cache[require.resolve('./g.cjs')]
    const n = await import('./n.mjs')
    said.push(n.read())
    mock.module('./g.cjs', () => ({ word: 'patch' }))
    said.push(n.read())
    vi.doUnmock('./g.cjs')
    said.push(n.read())
    console.log('SAID d1', said.join(' | '), globalThis.runs ?? 0)
})
