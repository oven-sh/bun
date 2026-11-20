import { mock, test, vi } from 'bun:test'
test('it', async () => {
    const said = []
    said.push(require('./g.cjs').word)
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    const n = await import('./n.mjs')
    said.push(n.read())
    vi.doMock('./g.cjs', () => ({ word: 'own two' }))
    vi.doUnmock('./g.cjs')
    said.push(n.read())
    mock.module('./g.cjs', () => ({ word: 'patch' }))
    said.push(n.read())
    vi.doUnmock('./g.cjs')
    said.push(n.read())
    console.log('SAID h6', said.join(' | '), globalThis.runs ?? 0)
})
