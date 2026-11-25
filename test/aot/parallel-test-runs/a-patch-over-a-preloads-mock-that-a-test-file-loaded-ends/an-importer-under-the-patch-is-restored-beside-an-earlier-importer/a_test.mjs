import { jest, mock, test, vi } from 'bun:test'
test('it', async () => {
    const said = []
    said.push(require('./g.cjs').word)
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    const n = await import('./n.mjs')
    mock.module('./g.cjs', () => ({ word: 'patch' }))
    const m = await import('./m.mjs')
    said.push(n.read(), m.read())
    vi.doUnmock('./g.cjs')
    said.push(n.read(), m.read(), (await import('./g.cjs')).word)
    console.log('SAID', said.join(' | '), globalThis.runs ?? 0)
})
