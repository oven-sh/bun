import { mock, test, vi } from 'bun:test'
test('it', async () => {
    const said = []
    const m = await import('./m.mjs')
    said.push(m.read())
    mock.module('./g.cjs', () => ({ word: 'patch' }))
    said.push(m.read())
    vi.doUnmock('./g.cjs')
    said.push(m.read())
    console.log('SAID x1', said.join(' | '), globalThis.runs ?? 0)
})
