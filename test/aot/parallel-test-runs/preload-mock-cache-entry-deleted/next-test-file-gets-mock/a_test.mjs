import { test, vi } from 'bun:test'
test('it', async () => {
    const said = [require('./g.cjs').word]
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    delete require.cache[require.resolve('./g.cjs')]
    said.push((await import('./n.mjs')).read())
    console.log('SAID e6 a', said.join(' | '), globalThis.runs ?? 0)
})
