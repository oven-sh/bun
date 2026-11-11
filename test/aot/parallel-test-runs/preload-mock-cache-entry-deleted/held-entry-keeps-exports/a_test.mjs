import { mock, test, vi } from 'bun:test'
test('it', async () => {
    const said = []
    said.push(require('./g.cjs').word)
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    const n = await import('./n.mjs')
    said.push(n.read())
    const key = require.resolve('./g.cjs')
    const entry = require.cache[key]
    delete require.cache[require.resolve('./g.cjs')]
    said.push(entry?.exports?.word, key in require.cache, Object.keys(require.cache).includes(key))
    console.log('SAID a_test c07', said.join(' | '), 'g ran', globalThis.runs ?? 0, 'bodies', globalThis.bodies ?? 0)
})
